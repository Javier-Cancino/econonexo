export interface InegiObservation {
  TIME_PERIOD: string
  OBS_VALUE: string
  OBS_EXCEPTION?: string
}

export interface InegiSeries {
  INDICADOR: string
  FREQ: string
  TOPIC: string
  UNIT: string
  UNIT_MULT: string
  NOTE: string
  SOURCE: string
  LASTUPDATE: string
  STATUS: string
  OBSERVATIONS: InegiObservation[]
}

export interface InegiResponse {
  Series: InegiSeries[]
}

export async function fetchInegiIndicator(
  indicatorId: string,
  token: string,
  area: string = '00',
  recent: boolean = false
): Promise<InegiResponse | null> {
  const reciente = recent ? 'true' : 'false'
  const url = `https://www.inegi.org.mx/app/api/indicadores/desarrolladores/jsonxml/INDICATOR/${indicatorId}/es/${area}/${reciente}/BIE-BISE/2.0/${token}?type=json`

  console.log('[INEGI] Fetching:', url.replace(token, 'TOKEN'))

  try {
    const response = await fetch(url)
    if (!response.ok) {
      const text = await response.text()
      console.error('[INEGI] API error:', response.status, 'body:', text)
      if (text.includes('ErrorCode:100')) {
        throw new Error('INEGI_NOT_FOUND')
      }
      throw new Error(`INEGI API error: ${response.status}`)
    }
    const data = await response.json()
    console.log('[INEGI] Response received, Series count:', data.Series?.length || 0)
    return data as InegiResponse
  } catch (error) {
    if (error instanceof Error && error.message === 'INEGI_NOT_FOUND') {
      throw error
    }
    console.error('[INEGI] Error:', error)
    return null
  }
}

export function parseInegiData(data: InegiResponse): { table: string[][]; csv: string } | null {
  if (!data?.Series || data.Series.length === 0) {
    console.log('[INEGI] No Series in response')
    return null
  }

  const series = data.Series[0]
  const observations = series.OBSERVATIONS

  if (!observations || observations.length === 0) {
    console.log('[INEGI] No observations in series')
    return null
  }

  console.log('[INEGI] Parsing', observations.length, 'observations, LASTUPDATE:', series.LASTUPDATE)

  const table: string[][] = []
  table.push(['Periodo', 'Valor', 'Unidad', 'UltimaActualizacion'])

  for (const obs of observations) {
    table.push([obs.TIME_PERIOD, obs.OBS_VALUE, series.UNIT, series.LASTUPDATE])
  }

  const csv = table.map((row) => row.map(cell => `"${cell}"`).join(',')).join('\n')

  return { table, csv }
}