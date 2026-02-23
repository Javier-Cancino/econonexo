import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { NextResponse } from 'next/server'
import { fetchInegiIndicator, parseInegiData } from '@/lib/sources/inegi'
import { fetchBanxicoSeries, parseBanxicoData } from '@/lib/sources/banxico'
import { fetchSHCPData, parseSHCPData, SHCPDataset } from '@/lib/sources/shcp'
import { SHCP_DATASETS } from '@/lib/sources/shcp'

async function searchCatalog(
  query: string,
  source: string
): Promise<{ id: string; descripcion: string }[]> {
  const normalized = query
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

  if (source === 'inegi') {
    const results = await prisma.$queryRaw<{ id: string; descripcion: string }[]>`
      SELECT id, descripcion,
        ts_rank(to_tsvector('spanish', descripcion), plainto_tsquery('spanish', ${query})) AS rank
      FROM inegi_indicadores
      WHERE to_tsvector('spanish', descripcion) @@ plainto_tsquery('spanish', ${query})
         OR descripcion ILIKE ${'%' + normalized + '%'}
      ORDER BY rank DESC
      LIMIT 10
    `
    return results
  }

  if (source === 'banxico') {
    const results = await prisma.$queryRaw<{ id: string; descripcion: string }[]>`
      SELECT id, titulo AS descripcion,
        ts_rank(to_tsvector('spanish', titulo), plainto_tsquery('spanish', ${query})) AS rank
      FROM banxico_series
      WHERE to_tsvector('spanish', titulo) @@ plainto_tsquery('spanish', ${query})
         OR titulo ILIKE ${'%' + normalized + '%'}
      ORDER BY rank DESC
      LIMIT 10
    `
    return results
  }

  return []
}

const SYSTEM_PROMPT = `Eres EconoNexo, un asistente especializado en consulta de datos económicos de México.

Tienes acceso a las siguientes herramientas:

1. **search_indicator** - Busca el ID de un indicador en el catálogo
   - Úsala CUANDO NO CONOZCAS el ID exacto del indicador
   - Parámetros: query (palabras clave), source ("inegi" o "banxico")
   - Devuelve hasta 10 coincidencias con sus IDs

2. **get_inegi_data** - Obtiene datos del INEGI (PIB, inflación, población, empleo, etc.)
   - Parámetro: indicator_id (string con el ID del indicador)

3. **get_banxico_data** - Obtiene series del Banco de México (tipo de cambio, tasas, reservas, UDIS, etc.)
   - Parámetro: series_id (string con el ID de la serie)

4. **get_shcp_data** - Obtiene datos de finanzas públicas de la SHCP
   - Parámetro: dataset_id ("deuda_publica", "ingreso_gasto", "transferencias", "rfsp", "deuda_amplia")

SHCP (usa get_shcp_data directamente):
${SHCP_DATASETS.map(d => `- ${d.id}: ${d.name}`).join('\n')}

INSTRUCCIONES:
- Para INEGI o Banxico: si NO conoces el ID exacto, PRIMERO llama search_indicator
- Con los resultados de search_indicator, elige el ID más relevante y llama get_inegi_data o get_banxico_data
- Para SHCP puedes llamar get_shcp_data directamente con el dataset_id
- Si hay ambigüedad, pregunta al usuario
- Responde siempre en español de forma clara y concisa

CRÍTICO: Cuando recibas datos de una herramienta, USA EXACTAMENTE los valores que vienen en la tabla. NUNCA inventes ni estimes valores. Si la tabla dice "25415332.95", di "25,415,332.95". Si la unidad dice "1054", di "código de unidad 1054" — no inventes "Pesos" ni ninguna otra unidad. Describe los datos reales de la tabla, no ejemplos hipotéticos.`

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_indicator',
      description: 'Busca el ID de un indicador en el catálogo de INEGI o Banxico cuando no conoces el ID exacto. Usa esta herramienta ANTES de get_inegi_data o get_banxico_data si no tienes el ID.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Palabras clave del indicador a buscar (ej: "inflacion", "PIB", "tipo de cambio")',
          },
          source: {
            type: 'string',
            enum: ['inegi', 'banxico'],
            description: 'Fuente donde buscar: "inegi" o "banxico"',
          },
        },
        required: ['query', 'source'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_inegi_data',
      description: 'Obtiene datos de indicadores económicos del INEGI (PIB, inflación, población, empleo, etc.)',
      parameters: {
        type: 'object',
        properties: {
          indicator_id: {
            type: 'string',
            description: 'ID del indicador INEGI (ej: 444456 para PIB, 5264722 para inflación anual)',
          },
        },
        required: ['indicator_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_banxico_data',
      description: 'Obtiene series financieras del Banco de México (tipo de cambio, tasas, reservas, UDIS, etc.)',
      parameters: {
        type: 'object',
        properties: {
          series_id: {
            type: 'string',
            description: 'ID de la serie Banxico (ej: SF43718 para tipo de cambio FIX, SF61745 para tasa objetivo)',
          },
        },
        required: ['series_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_shcp_data',
      description: 'Obtiene datos de finanzas públicas de la SHCP (deuda, ingresos, gastos, RFSP)',
      parameters: {
        type: 'object',
        properties: {
          dataset_id: {
            type: 'string',
            enum: ['deuda_publica', 'ingreso_gasto', 'transferencias', 'rfsp', 'deuda_amplia'],
            description: 'ID del dataset SHCP',
          },
        },
        required: ['dataset_id'],
      },
    },
  },
]

function decryptKey(encryptedKey: string): string {
  return Buffer.from(encryptedKey, 'base64').toString('utf-8')
}

async function getApiKey(userId: string, provider: string): Promise<string | null> {
  const apiKey = await prisma.apiKey.findUnique({
    where: { userId_provider: { userId, provider } },
  })
  return apiKey ? decryptKey(apiKey.key) : null
}

function isQuotaError(error: string): boolean {
  const quotaKeywords = ['quota', 'rate limit', 'exceeded', 'limit: 0', '429']
  return quotaKeywords.some(keyword => error.toLowerCase().includes(keyword))
}

async function callLLMWithTools(
  provider: string,
  apiKey: string,
  messages: { role: string; content: string | null }[],
  tools?: any[]
): Promise<{ content: string | null; toolCalls: any[]; error?: string }> {
  try {
    if (provider === 'openai' || provider === 'groq') {
      const baseUrl = provider === 'openai' 
        ? 'https://api.openai.com/v1/chat/completions'
        : 'https://api.groq.com/openai/v1/chat/completions'
      
      const model = provider === 'openai' ? 'gpt-4o-mini' : 'llama-3.3-70b-versatile'
      
      const body: any = {
        model,
        messages,
        temperature: 0.3,
      }
      
      if (tools) {
        body.tools = tools
        body.tool_choice = 'auto'
      }
      
      console.log(`[LLM] Calling ${provider} with model ${model}`)
      
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
      
      const data = await res.json()
      
      if (!res.ok) {
        console.error(`[LLM] ${provider} API error:`, JSON.stringify(data, null, 2))
        return { content: null, toolCalls: [], error: data.error?.message || `API error: ${res.status}` }
      }
      
      const message = data.choices?.[0]?.message
      console.log(`[LLM] ${provider} response:`, JSON.stringify({ 
        hasContent: !!message?.content, 
        toolCallsCount: message?.tool_calls?.length || 0 
      }))
      
      return {
        content: message?.content || null,
        toolCalls: message?.tool_calls || [],
      }
    }

    if (provider === 'google') {
      const functions = tools?.map(t => ({
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      })) || []

      const body: any = {
        contents: messages
          .filter(m => m.role !== 'system')
          .map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content || '' }],
          })),
        systemInstruction: {
          parts: [{ text: messages.find(m => m.role === 'system')?.content || '' }],
        },
      }

      if (functions.length > 0) {
        body.tools = [{ functionDeclarations: functions }]
      }

      console.log('[LLM] Calling Google Gemini')

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      )

      const data = await res.json()
      
      if (!res.ok) {
        console.error('[LLM] Google API error:', JSON.stringify(data, null, 2))
        return { content: null, toolCalls: [], error: data.error?.message || `API error: ${res.status}` }
      }
      
      const candidate = data.candidates?.[0]
      const functionCall = candidate?.content?.parts?.find((p: any) => p.functionCall)?.functionCall
      
      if (functionCall) {
        console.log('[LLM] Google function call:', functionCall.name)
        return {
          content: null,
          toolCalls: [{
            id: `call_${Date.now()}`,
            type: 'function',
            function: {
              name: functionCall.name,
              arguments: JSON.stringify(functionCall.args),
            },
          }],
        }
      }

      console.log('[LLM] Google response has text')
      return {
        content: candidate?.content?.parts?.[0]?.text || null,
        toolCalls: [],
      }
    }

    return { content: null, toolCalls: [], error: `Unknown provider: ${provider}` }
  } catch (err) {
    console.error('[LLM] Exception:', err)
    return { content: null, toolCalls: [], error: String(err) }
  }
}

async function executeToolCall(
  toolName: string,
  args: Record<string, string>,
  userId: string
): Promise<{ table: string[][]; csv: string; source: string } | { results: { id: string; descripcion: string }[] } | { error: string; indicator_id: string } | null> {
  console.log('[TOOL] Executing:', toolName, 'with args:', JSON.stringify(args))
  
  try {
    if (toolName === 'search_indicator') {
      const results = await searchCatalog(args.query, args.source)
      console.log('[TOOL] Search results:', results.length, 'matches')
      return { results }
    }

    if (toolName === 'get_inegi_data') {
      const inegiToken = await getApiKey(userId, 'inegi')
      if (!inegiToken) {
        console.log('[TOOL] No INEGI token configured')
        return null
      }
      
      try {
        const data = await fetchInegiIndicator(args.indicator_id, inegiToken)
        if (data) {
          const parsed = parseInegiData(data)
          if (parsed) {
            console.log('[TOOL] INEGI data parsed:', parsed.table.length, 'rows')
            const indicatorInfo = await prisma.inegiIndicador.findUnique({
              where: { id: args.indicator_id }
            })
            const nombre = indicatorInfo?.descripcion?.split('/')[0]?.trim() || args.indicator_id
            return { ...parsed, source: `INEGI - ${nombre}` }
          }
        }
        console.log('[TOOL] INEGI data fetch/parse failed')
        return null
      } catch (error) {
        if (error instanceof Error && error.message === 'INEGI_NOT_FOUND') {
          console.log('[TOOL] INEGI indicator not found:', args.indicator_id)
          return { error: 'not_found', indicator_id: args.indicator_id }
        }
        console.error('[TOOL] INEGI error:', error)
        return null
      }
    }

    if (toolName === 'get_banxico_data') {
      const banxicoToken = await getApiKey(userId, 'banxico')
      if (!banxicoToken) {
        console.log('[TOOL] No Banxico token configured')
        return null
      }
      
      const data = await fetchBanxicoSeries(args.series_id, banxicoToken)
      if (data) {
        const parsed = parseBanxicoData(data)
        if (parsed) {
          console.log('[TOOL] Banxico data parsed:', parsed.table.length, 'rows')
          const serieInfo = await prisma.banxicoSerie.findUnique({
            where: { id: args.series_id }
          })
          const nombre = serieInfo?.titulo?.split('.')[0]?.trim() || args.series_id
          return { ...parsed, source: `Banxico - ${nombre}` }
        }
      }
      console.log('[TOOL] Banxico data fetch/parse failed')
      return null
    }

    if (toolName === 'get_shcp_data') {
      const csvString = await fetchSHCPData(args.dataset_id as SHCPDataset)
      if (csvString) {
        const parsed = parseSHCPData(csvString)
        if (parsed) {
          console.log('[TOOL] SHCP data parsed:', parsed.table.length, 'rows')
          return { ...parsed, source: 'SHCP' }
        }
      }
      console.log('[TOOL] SHCP data fetch/parse failed')
      return null
    }

    console.log('[TOOL] Unknown tool:', toolName)
    return null
  } catch (err) {
    console.error('[TOOL] Exception:', err)
    return null
  }
}

async function callLLMWithToolResult(
  provider: string,
  apiKey: string,
  messages: { role: string; content: string | null }[],
  toolCallId: string,
  toolName: string,
  toolResult: any
): Promise<string> {
  console.log('[LLM] Calling with tool result for:', toolName)
  
  try {
    if (provider === 'openai' || provider === 'groq') {
      const baseUrl = provider === 'openai' 
        ? 'https://api.openai.com/v1/chat/completions'
        : 'https://api.groq.com/openai/v1/chat/completions'
      
      const model = provider === 'openai' ? 'gpt-4o-mini' : 'llama-3.3-70b-versatile'

      const messagesWithResult = [
        ...messages,
        {
          role: 'tool',
          tool_call_id: toolCallId,
          content: JSON.stringify(toolResult),
        },
      ]

      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: messagesWithResult,
          temperature: 0.3,
        }),
      })

      const data = await res.json()
      
      if (!res.ok) {
        console.error('[LLM] Error with tool result:', JSON.stringify(data, null, 2))
        return ''
      }
      
      return data.choices?.[0]?.message?.content || ''
    }

    if (provider === 'google') {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              ...messages
                .filter(m => m.role !== 'system')
                .map(m => ({
                  role: m.role === 'assistant' ? 'model' : 'user',
                  parts: [{ text: m.content || '' }],
                })),
              {
                role: 'function',
                parts: [{
                  functionResponse: {
                    name: toolName,
                    response: toolResult,
                  },
                }],
              },
            ],
            systemInstruction: {
              parts: [{ text: messages.find(m => m.role === 'system')?.content || '' }],
            },
          }),
        }
      )

      const data = await res.json()
      return data.candidates?.[0]?.content?.parts?.[0]?.text || ''
    }

    return ''
  } catch (err) {
    console.error('[LLM] Exception with tool result:', err)
    return ''
  }
}

async function callLLMWithToolResultAndContinue(
  provider: string,
  apiKey: string,
  messages: { role: string; content: string | null }[],
  toolCallId: string,
  toolName: string,
  toolResult: any,
  tools: any[]
): Promise<{ content: string | null; toolCalls: any[]; error?: string }> {
  console.log('[LLM] Calling with tool result and continuing, tool:', toolName)
  
  try {
    if (provider === 'openai' || provider === 'groq') {
      const baseUrl = provider === 'openai' 
        ? 'https://api.openai.com/v1/chat/completions'
        : 'https://api.groq.com/openai/v1/chat/completions'
      
      const model = provider === 'openai' ? 'gpt-4o-mini' : 'llama-3.3-70b-versatile'

      const messagesWithResult = [
        ...messages,
        {
          role: 'tool',
          tool_call_id: toolCallId,
          content: JSON.stringify(toolResult),
        },
      ]

      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: messagesWithResult,
          temperature: 0.3,
          tools,
          tool_choice: 'auto',
        }),
      })

      const data = await res.json()
      
      if (!res.ok) {
        console.error('[LLM] Error with tool result:', JSON.stringify(data, null, 2))
        return { content: null, toolCalls: [], error: data.error?.message || `API error: ${res.status}` }
      }
      
      const message = data.choices?.[0]?.message
      console.log('[LLM] Response after tool:', JSON.stringify({ 
        hasContent: !!message?.content, 
        toolCallsCount: message?.tool_calls?.length || 0 
      }))
      
      return {
        content: message?.content || null,
        toolCalls: message?.tool_calls || [],
      }
    }

    if (provider === 'google') {
      const functions = tools?.map(t => ({
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      })) || []

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              ...messages
                .filter(m => m.role !== 'system')
                .map(m => ({
                  role: m.role === 'assistant' ? 'model' : 'user',
                  parts: [{ text: m.content || '' }],
                })),
              {
                role: 'function',
                parts: [{
                  functionResponse: {
                    name: toolName,
                    response: toolResult,
                  },
                }],
              },
            ],
            systemInstruction: {
              parts: [{ text: messages.find(m => m.role === 'system')?.content || '' }],
            },
            tools: functions.length > 0 ? [{ functionDeclarations: functions }] : undefined,
          }),
        }
      )

      const data = await res.json()
      
      if (!res.ok) {
        return { content: null, toolCalls: [], error: data.error?.message || `API error: ${res.status}` }
      }
      
      const candidate = data.candidates?.[0]
      const functionCall = candidate?.content?.parts?.find((p: any) => p.functionCall)?.functionCall
      
      if (functionCall) {
        return {
          content: null,
          toolCalls: [{
            id: `call_${Date.now()}`,
            type: 'function',
            function: {
              name: functionCall.name,
              arguments: JSON.stringify(functionCall.args),
            },
          }],
        }
      }

      return {
        content: candidate?.content?.parts?.[0]?.text || null,
        toolCalls: [],
      }
    }

    return { content: null, toolCalls: [], error: `Unknown provider: ${provider}` }
  } catch (err) {
    console.error('[LLM] Exception with tool result:', err)
    return { content: null, toolCalls: [], error: String(err) }
  }
}

export async function POST(request: Request) {
  console.log('[API] POST /api/chat received')
  
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      console.log('[API] Unauthorized - no session')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { message } = body
    console.log('[API] Message:', message?.substring(0, 100))

    const availableProviders: { provider: string; key: string }[] = []
    
    const groqKey = await getApiKey(session.user.id, 'groq')
    if (groqKey) availableProviders.push({ provider: 'groq', key: groqKey })
    
    const openaiKey = await getApiKey(session.user.id, 'openai')
    if (openaiKey) availableProviders.push({ provider: 'openai', key: openaiKey })
    
    const googleKey = await getApiKey(session.user.id, 'google')
    if (googleKey) availableProviders.push({ provider: 'google', key: googleKey })

    if (availableProviders.length === 0) {
      console.log('[API] No LLM key found for user')
      return NextResponse.json({
        message: 'No tienes configurada ninguna API Key de LLM. Ve a Configuración y añade una API Key de OpenAI, Google o Groq.',
      })
    }

    console.log('[API] Available providers:', availableProviders.map(p => p.provider).join(', '))

    const messages: { role: string; content: string | null }[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: message },
    ]

    let usedProvider: { provider: string; key: string } | null = null
    let lastToolCallId: string | null = null
    let lastToolName: string | null = null
    const maxIterations = 5
    let iteration = 0

    while (iteration < maxIterations) {
      iteration++
      
      let llmResponse: { content: string | null; toolCalls: any[]; error?: string } | null = null

      for (const { provider, key } of availableProviders) {
        console.log(`[API] Iteration ${iteration}, trying provider:`, provider)
        const response = await callLLMWithTools(provider, key, messages, TOOLS)
        
        if (!response.error || !isQuotaError(response.error)) {
          llmResponse = response
          usedProvider = { provider, key }
          break
        }
        
        console.log('[API] Provider', provider, 'failed with quota error, trying next...')
      }

      if (!llmResponse || !usedProvider) {
        return NextResponse.json({
          message: 'Todos los proveedores de LLM han excedido su cuota. Intenta más tarde o añade otra API Key.',
        })
      }

      if (llmResponse.error) {
        console.log('[API] LLM error:', llmResponse.error)
        return NextResponse.json({
          message: `Error del LLM: ${llmResponse.error}`,
        })
      }

      if (llmResponse.toolCalls.length === 0) {
        console.log('[API] No tool calls, returning direct response')
        return NextResponse.json({
          message: llmResponse.content || 'No pude procesar tu solicitud.',
        })
      }

      const toolCall = llmResponse.toolCalls[0]
      const toolName = toolCall.function.name
      let toolArgs: Record<string, string> = {}
      
      try {
        toolArgs = JSON.parse(toolCall.function.arguments)
      } catch (e) {
        console.error('[API] Failed to parse tool arguments:', toolCall.function.arguments)
        return NextResponse.json({
          message: 'Error al procesar los argumentos de la función.',
        })
      }

      console.log('[API] Tool call:', toolName, toolArgs)

      const toolResult = await executeToolCall(toolName, toolArgs, session.user.id)

      if (toolResult && 'error' in toolResult && toolResult.error === 'not_found') {
        return NextResponse.json({
          message: `El indicador ${toolResult.indicator_id} no existe en INEGI o no está disponible. Intenta buscar con otros términos usando el catálogo.`,
        })
      }

      if (!toolResult) {
        const missingKey = 
          toolName === 'get_inegi_data' ? 'inegi' :
          toolName === 'get_banxico_data' ? 'banxico' : null
        
        if (missingKey) {
          const hasKey = await getApiKey(session.user.id, missingKey)
          if (!hasKey) {
            const keyName = missingKey.toUpperCase()
            return NextResponse.json({
              message: `No tienes configurada la API Key de ${keyName}. Ve a Configuración y añade tu token de ${keyName}.`,
            })
          }
        }
        
        return NextResponse.json({
          message: 'No pude obtener los datos solicitados. Verifica que el indicador exista.',
        })
      }

      messages.push({ role: 'assistant', content: null })
      if (usedProvider.provider === 'openai' || usedProvider.provider === 'groq') {
        (messages[messages.length - 1] as any).tool_calls = llmResponse.toolCalls
      }

      if ('results' in toolResult) {
        console.log('[API] Search results returned, asking LLM to continue...')
        
        const nextResponse = await callLLMWithToolResultAndContinue(
          usedProvider.provider,
          usedProvider.key,
          messages,
          toolCall.id,
          toolName,
          toolResult,
          TOOLS
        )

        if (nextResponse.error) {
          return NextResponse.json({
            message: `Error del LLM: ${nextResponse.error}`,
          })
        }

        if (nextResponse.toolCalls.length > 0) {
          lastToolCallId = toolCall.id
          lastToolName = toolName
          continue
        }

        return NextResponse.json({
          message: nextResponse.content || 'Encontré estos indicadores en el catálogo.',
        })
      }

      if (!('table' in toolResult)) {
        return NextResponse.json({
          message: 'Error inesperado al procesar los datos.',
        })
      }

      const finalResponse = await callLLMWithToolResult(
        usedProvider.provider,
        usedProvider.key,
        messages,
        toolCall.id,
        toolName,
        {
          success: true,
          data: {
            rows: toolResult.table.length - 1,
            columns: toolResult.table[0],
            source: toolResult.source,
          },
        }
      )

      console.log('[API] Returning response with data from provider:', usedProvider.provider)
      return NextResponse.json({
        message: finalResponse || `Aquí están los datos de ${toolResult.source}:`,
        data: {
          table: toolResult.table,
          csv: toolResult.csv,
          source: toolResult.source,
        },
      })
    }

    return NextResponse.json({
      message: 'Se alcanzó el límite de iteraciones. Por favor, sé más específico en tu solicitud.',
    })
  } catch (error) {
    console.error('[API] Unhandled error:', error)
    if (error instanceof Error) {
      console.error('[API] Stack trace:', error.stack)
    }
    return NextResponse.json({
      message: 'Error al procesar la solicitud. Revisa los logs del servidor.',
    })
  }
}