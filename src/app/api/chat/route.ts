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
        const results = await searchCatalog(query, source)
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
      }),
      execute: async ({ series_id }) => {
        console.log('[TOOL] get_banxico_data:', series_id)
        
        const banxicoToken = await getApiKey(userId, 'banxico')
        if (!banxicoToken) {
          console.log('[TOOL] No Banxico token configured')
          return { error: 'no_api_key', indicator_id: series_id }
        }

        const data = await fetchBanxicoSeries(series_id, banxicoToken)
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
  const quotaKeywords = ['quota', 'rate limit', 'exceeded', 'limit: 0', '429']
  return quotaKeywords.some(keyword => error.toLowerCase().includes(keyword))
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
    if (googleKey) providers.push({ name: 'google', key: googleKey, model: 'gemini-2.0-flash' })

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
          continue
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

        const lastStepWithTable = result.steps
          .toReversed()
          .find(step => step.toolResults?.some((r: any) => r.output?.table))

        if (lastStepWithTable) {
          const toolResult = lastStepWithTable.toolResults.find((r: any) => r.output?.table)?.output
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
          const errorResult = errorStep.toolResults.find((r: any) => r.output?.error)?.output
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
        console.error(`[API] Provider ${provider.name} error:`, errorMessage)
        
        if (isQuotaError(errorMessage)) {
          lastError = errorMessage
          continue
        }
        
        return NextResponse.json({
          message: `Error del LLM: ${errorMessage}`,
        })
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
