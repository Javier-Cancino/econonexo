import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { NextResponse } from 'next/server'
import { generateText, tool, stepCountIs } from 'ai'
import type { LanguageModel } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createGroq } from '@ai-sdk/groq'
import { z } from 'zod'
import OpenAI from 'openai'
import { fetchInegiIndicator, parseInegiData } from '@/lib/sources/inegi'
import { fetchBanxicoSeries, parseBanxicoData } from '@/lib/sources/banxico'
import { fetchSHCPData, parseSHCPData, SHCPDataset } from '@/lib/sources/shcp'
import { SHCP_DATASETS } from '@/lib/sources/shcp'

type DataToolOutput = {
  table: string[][]
  csv: string
  source: string
}

type ErrorToolOutput = {
  error: 'not_found' | 'no_api_key' | 'fetch_failed'
  indicator_id?: string
}

const voyageClient = new OpenAI({
  apiKey: process.env.VOYAGE_API_KEY || '',
  baseURL: 'https://api.voyageai.com/v1'
})

async function getQueryEmbedding(text: string, voyageApiKey?: string): Promise<number[]> {
  const apiKey = voyageApiKey || process.env.VOYAGE_API_KEY
  if (!apiKey) {
    throw new Error('VOYAGE_API_KEY not configured')
  }
  
  const client = voyageApiKey ? new OpenAI({
    apiKey: voyageApiKey,
    baseURL: 'https://api.voyageai.com/v1'
  }) : voyageClient
  
  const response = await client.embeddings.create({
    model: 'voyage-3-lite',
    input: text,
  })
  return response.data[0].embedding
}

async function searchCatalog(
  query: string,
  source: string,
  userId?: string
): Promise<{ id: string; descripcion: string }[]> {
  const table = source === 'inegi' ? 'inegi_indicadores' : 'banxico_series'
  const textCol = source === 'inegi' ? 'descripcion' : 'titulo'

  const normalized = query
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

  let voyageApiKey: string | undefined
  if (userId) {
    voyageApiKey = await getApiKey(userId, 'voyage') || undefined
  }

  try {
    const embedding = await getQueryEmbedding(query, voyageApiKey)
    const vectorString = `[${embedding.join(',')}]`

    const results = await prisma.$queryRawUnsafe<{ id: string; descripcion: string }[]>(`
      WITH fts_search AS (
        SELECT id,
               ${textCol} AS descripcion,
               ROW_NUMBER() OVER (
                 ORDER BY ts_rank(
                   to_tsvector('spanish', ${textCol}),
                   plainto_tsquery('spanish', $1)
                 ) DESC
               ) AS rank
        FROM ${table}
        WHERE to_tsvector('spanish', ${textCol}) @@ plainto_tsquery('spanish', $1)
           OR ${textCol} ILIKE $2
        LIMIT 50
      ),
      semantic_search AS (
        SELECT id,
               ${textCol} AS descripcion,
               ROW_NUMBER() OVER (
                 ORDER BY embedding <=> $3::vector
               ) AS rank
        FROM ${table}
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> $3::vector
        LIMIT 50
      ),
      rrf AS (
        SELECT
          COALESCE(f.id, s.id) AS id,
          COALESCE(f.descripcion, s.descripcion) AS descripcion,
          COALESCE(1.0 / (60 + f.rank), 0.0) +
          COALESCE(1.0 / (60 + s.rank), 0.0) AS rrf_score
        FROM fts_search f
        FULL OUTER JOIN semantic_search s ON f.id = s.id
      )
      SELECT id, descripcion
      FROM rrf
      ORDER BY rrf_score DESC
      LIMIT 10
    `, query, `%${normalized}%`, vectorString)

    return results
  } catch (error) {
    console.error('[SEARCH] Hybrid search failed, falling back to FTS:', error)
    
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
- CRÍTICO - REGLA DE ORO: Para INEGI y Banxico, SIEMPRE debes llamar search_indicator PRIMERO antes de cualquier otra herramienta. NUNCA uses IDs de tu conocimiento previo o memoria. Los IDs de indicadores SOLO son válidos si provienen directamente del resultado de search_indicator en esta conversación. Si no encuentras resultados con una query, intenta con términos más cortos o diferentes.
- Con los resultados de search_indicator, elige el ID más relevante y llama get_inegi_data o get_banxico_data
- Cuando search_indicator devuelva múltiples resultados, lee cada descripción cuidadosamente. Si el usuario quiere una "tasa", selecciona el ID cuya descripción contenga "Tasa de Rendimiento". Evita IDs con "Plazo" o "Precio" salvo que el usuario los pida explícitamente.
- Para SHCP puedes llamar get_shcp_data directamente con el dataset_id
- Si hay ambigüedad, pregunta al usuario
- Responde siempre en español de forma clara y concisa
- UNA VEZ QUE OBTENGAS DATOS de get_inegi_data, get_banxico_data o get_shcp_data, NO llames más herramientas. Responde de inmediato con los datos.
- NO repitas search_indicator si ya obtuviste datos exitosamente.
- FECHAS PARA SERIES HISTÓRICAS: Cuando el usuario pida "serie histórica", "últimos X meses/años", o datos de un período específico, DEBES incluir start_date y end_date en get_banxico_data. Formato: YYYY-MM-DD. Ejemplos:
  • "últimos 6 meses" → start_date: fecha de hace 6 meses desde hoy, end_date: fecha de hoy
  • "datos de 2023" → start_date: "2023-01-01", end_date: "2023-12-31"
  • "últimos 3 años" → start_date: hace 3 años desde hoy, end_date: hoy
  • "últimos 10 datos" → start_date: hace 15 días desde hoy, end_date: hoy
  • "octubre 2025" → start_date: "2025-10-01", end_date: "2025-10-31"
  • Si el usuario NO especifica período, NO pases start_date ni end_date (traerá solo el último dato disponible)
  • FECHA ACTUAL: ${new Date().toISOString().split('T')[0]}

CRÍTICO: Cuando recibas datos de una herramienta, USA EXACTAMENTE los valores que vienen en la tabla. NUNCA inventes ni estimes valores. Si la tabla dice "25415332.95", di "25,415,332.95". Si la unidad dice "1054", di "código de unidad 1054" — no inventes "Pesos" ni ninguna otra unidad. Describe los datos reales de la tabla, no ejemplos hipotéticos.`

function decryptKey(encryptedKey: string): string {
  return Buffer.from(encryptedKey, 'base64').toString('utf-8')
}

async function getApiKey(userId: string, provider: string): Promise<string | null> {
  const apiKey = await prisma.apiKey.findUnique({
    where: { userId_provider: { userId, provider } },
  })
  return apiKey ? decryptKey(apiKey.key) : null
}

function createTools(userId: string) {
  return {
    search_indicator: tool({
      description: 'Busca el ID de un indicador en el catálogo de INEGI o Banxico cuando no conoces el ID exacto. Usa esta herramienta ANTES de get_inegi_data o get_banxico_data si no tienes el ID.',
      inputSchema: z.object({
        query: z.string().describe('Palabras clave del indicador a buscar (ej: "inflacion", "PIB", "tipo de cambio")'),
        source: z.enum(['inegi', 'banxico']).describe('Fuente donde buscar: "inegi" o "banxico"'),
      }),
      execute: async ({ query, source }) => {
        console.log('[TOOL] search_indicator:', query, source)
        const results = await searchCatalog(query, source, userId)
        console.log('[TOOL] Search results:', results.length, 'matches')
        return { results }
      },
    }),

    get_inegi_data: tool({
      description: 'Obtiene datos de indicadores económicos del INEGI (PIB, inflación, población, empleo, etc.)',
      inputSchema: z.object({
        indicator_id: z.string().describe('ID del indicador INEGI (ej: 444456 para PIB, 5264722 para inflación anual)'),
      }),
      execute: async ({ indicator_id }) => {
        console.log('[TOOL] get_inegi_data:', indicator_id)
        
        const inegiToken = await getApiKey(userId, 'inegi')
        if (!inegiToken) {
          console.log('[TOOL] No INEGI token configured')
          return { error: 'no_api_key', indicator_id }
        }

        try {
          const data = await fetchInegiIndicator(indicator_id, inegiToken)
          if (data) {
            const parsed = parseInegiData(data)
            if (parsed) {
              console.log('[TOOL] INEGI data parsed:', parsed.table.length, 'rows')
              const indicatorInfo = await prisma.inegiIndicador.findUnique({
                where: { id: indicator_id }
              })
              const nombre = indicatorInfo?.descripcion?.split('/')[0]?.trim() || indicator_id
              return { ...parsed, source: `INEGI - ${nombre}` }
            }
          }
          console.log('[TOOL] INEGI data fetch/parse failed')
          return { error: 'fetch_failed', indicator_id }
        } catch (error) {
          if (error instanceof Error && error.message === 'INEGI_NOT_FOUND') {
            console.log('[TOOL] INEGI indicator not found:', indicator_id)
            return { error: 'not_found', indicator_id }
          }
          console.error('[TOOL] INEGI error:', error)
          return { error: 'fetch_failed', indicator_id }
        }
      },
    }),

    get_banxico_data: tool({
      description: 'Obtiene series financieras del Banco de México (tipo de cambio, tasas, reservas, UDIS, etc.)',
      inputSchema: z.object({
        series_id: z.string().describe('ID de la serie Banxico (ej: SF43718 para tipo de cambio FIX, SF61745 para tasa objetivo)'),
        start_date: z.string().optional().describe('Fecha inicio YYYY-MM-DD'),
        end_date: z.string().optional().describe('Fecha fin YYYY-MM-DD'),
      }),
      execute: async ({ series_id, start_date, end_date }) => {
        console.log('[TOOL] get_banxico_data:', series_id, start_date, end_date)
        
        const banxicoToken = await getApiKey(userId, 'banxico')
        if (!banxicoToken) {
          console.log('[TOOL] No Banxico token configured')
          return { error: 'no_api_key', indicator_id: series_id }
        }

        const data = await fetchBanxicoSeries(series_id, banxicoToken, start_date, end_date)
        if (data) {
          const parsed = parseBanxicoData(data)
          if (parsed) {
            console.log('[TOOL] Banxico data parsed:', parsed.table.length, 'rows')
            const serieInfo = await prisma.banxicoSerie.findUnique({
              where: { id: series_id }
            })
            const nombre = serieInfo?.titulo?.split('.')[0]?.trim() || series_id
            return { ...parsed, source: `Banxico - ${nombre}` }
          }
        }
        console.log('[TOOL] Banxico data fetch/parse failed')
        return { error: 'fetch_failed', indicator_id: series_id }
      },
    }),

    get_shcp_data: tool({
      description: 'Obtiene datos de finanzas públicas de la SHCP (deuda, ingresos, gastos, RFSP)',
      inputSchema: z.object({
        dataset_id: z.enum(['deuda_publica', 'ingreso_gasto', 'transferencias', 'rfsp', 'deuda_amplia']).describe('ID del dataset SHCP'),
      }),
      execute: async ({ dataset_id }) => {
        console.log('[TOOL] get_shcp_data:', dataset_id)
        
        const csvString = await fetchSHCPData(dataset_id as SHCPDataset)
        if (csvString) {
          const parsed = parseSHCPData(csvString)
          if (parsed) {
            console.log('[TOOL] SHCP data parsed:', parsed.table.length, 'rows')
            return { ...parsed, source: 'SHCP' }
          }
        }
        console.log('[TOOL] SHCP data fetch/parse failed')
        return { error: 'fetch_failed' }
      },
    }),
  }
}

function isQuotaError(error: string): boolean {
  const quotaKeywords = [
    'quota',
    'rate limit',
    'exceeded',
    'limit: 0',
    '429',
    'Rate limit reached',
    'TPD:',
  ]
  return quotaKeywords.some(keyword => error.toLowerCase().includes(keyword.toLowerCase()))
}

function isToolCallError(error: string): boolean {
  return error.includes('tool_use_failed') || 
         error.includes('Failed to call a function')
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

    const groqKey = await getApiKey(session.user.id, 'groq')
    const openaiKey = await getApiKey(session.user.id, 'openai')
    const googleKey = await getApiKey(session.user.id, 'google')

    const providers: { name: string; key: string; model: string }[] = []
    if (groqKey) providers.push({ name: 'groq', key: groqKey, model: 'llama-3.3-70b-versatile' })
    if (openaiKey) providers.push({ name: 'openai', key: openaiKey, model: 'gpt-4o-mini' })
    if (googleKey) providers.push({ name: 'google', key: googleKey, model: 'gemini-1.5-flash-latest' })

    if (providers.length === 0) {
      console.log('[API] No LLM key found for user')
      return NextResponse.json({
        message: 'No tienes configurada ninguna API Key de LLM. Ve a Configuración y añade una API Key de OpenAI, Google o Groq.',
      })
    }

    console.log('[API] Available providers:', providers.map(p => p.name).join(', '))

    const tools = createTools(session.user.id)
    let lastError: string | null = null

    for (const provider of providers) {
      console.log(`[API] Trying provider: ${provider.name}`)
      
      const MAX_RETRIES = 2
      let attempt = 0
      
      while (attempt <= MAX_RETRIES) {
        try {
          let model: LanguageModel
          if (provider.name === 'groq') {
            const groq = createGroq({ apiKey: provider.key })
            model = groq(provider.model)
          } else if (provider.name === 'openai') {
            const openai = createOpenAI({ apiKey: provider.key })
            model = openai(provider.model)
          } else if (provider.name === 'google') {
            const google = createGoogleGenerativeAI({ apiKey: provider.key })
            model = google(provider.model)
          } else {
            break
          }

          const result = await generateText({
            model,
            system: SYSTEM_PROMPT,
            prompt: message,
            tools,
            stopWhen: stepCountIs(5),
            onStepFinish: ({ stepNumber, toolCalls }) => {
              console.log(`[API] Step ${stepNumber} finished, tool calls:`, toolCalls?.length || 0)
            },
          })

          console.log('[API] Generation completed, steps:', result.steps.length)

          const stepWithTable = result.steps
            .find(step => step.toolResults?.some((r: any) => r.output?.table))

          if (stepWithTable) {
            const toolResult = stepWithTable.toolResults.find((r: any) => r.output?.table)?.output as DataToolOutput | undefined
            if (toolResult) {
              const responseMessage = result.text || `Aquí están los datos de ${toolResult.source}:`
              return NextResponse.json({
                message: responseMessage,
                data: {
                  table: toolResult.table,
                  csv: toolResult.csv,
                  source: toolResult.source,
                },
              })
            }
          }

          const errorStep = result.steps
            .toReversed()
            .find(step => step.toolResults?.some((r: any) => r.output?.error))

          if (errorStep) {
            const errorResult = errorStep.toolResults.find((r: any) => r.output?.error)?.output as ErrorToolOutput | undefined
            if (errorResult?.error === 'not_found') {
              return NextResponse.json({
                message: `El indicador ${errorResult.indicator_id} no existe en INEGI o no está disponible. Intenta buscar con otros términos usando el catálogo.`,
              })
            }
            if (errorResult?.error === 'no_api_key') {
              const keyName = errorResult.indicator_id?.startsWith('SF') ? 'BANXICO' : 'INEGI'
              return NextResponse.json({
                message: `No tienes configurada la API Key de ${keyName}. Ve a Configuración y añade tu token de ${keyName}.`,
              })
            }
          }

          return NextResponse.json({
            message: result.text || 'No pude procesar tu solicitud.',
          })

        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          
          if (isToolCallError(errorMessage) && attempt < MAX_RETRIES) {
            attempt++
            console.log(`[API] Tool call error, retrying (${attempt}/${MAX_RETRIES})...`)
            await new Promise(r => setTimeout(r, 500))
            continue
          }
          
          if (isQuotaError(errorMessage)) {
            lastError = errorMessage
            break
          }
          
          console.error(`[API] Provider ${provider.name} error:`, errorMessage)
          return NextResponse.json({
            message: `Error del LLM: ${errorMessage}`,
          })
        }
      }
    }

    return NextResponse.json({
      message: 'Todos los proveedores de LLM han excedido su cuota. Intenta más tarde o añade otra API Key.',
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
