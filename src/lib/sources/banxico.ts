export interface BanxicoObservation {
  fecha: string
  dato: string
}

export interface BanxicoSeries {
  idSerie: string
  titulo: string
  datos: BanxicoObservation[]
}

export interface BanxicoResponse {
  bmx: {
    series: BanxicoSeries[]
  }
}

export async function fetchBanxicoSeries(
  seriesId: string,
  token: string,
  startDate?: string,
  endDate?: string,
  latest: boolean = false
): Promise<BanxicoResponse | null> {
  let url: string
  
  if (latest) {
    url = `https://www.banxico.org.mx/SieAPIRest/service/v1/series/${seriesId}/datos/oportuno`
  } else if (startDate && endDate) {
    url = `https://www.banxico.org.mx/SieAPIRest/service/v1/series/${seriesId}/datos/${startDate}/${endDate}`
  } else {
    url = `https://www.banxico.org.mx/SieAPIRest/service/v1/series/${seriesId}/datos`
  }

  console.log('[BANXICO] Fetching:', url)

  try {
    const response = await fetch(url, {
      headers: {
        'Bmx-Token': token,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      console.error('[BANXICO] API error:', response.status)
      throw new Error(`Banxico API error: ${response.status}`)
    }

    const data = await response.json()
    console.log('[BANXICO] Response received, series count:', data.bmx?.series?.length || 0)
    return data as BanxicoResponse
  } catch (error) {
    console.error('[BANXICO] Error:', error)
    return null
  }
}

export function parseBanxicoData(
  data: BanxicoResponse
): { table: string[][]; csv: string } | null {
  if (!data?.bmx?.series || data.bmx.series.length === 0) {
    console.log('[BANXICO] No series in response')
    return null
  }

  const series = data.bmx.series[0]
  const observations = series.datos

  if (!observations || observations.length === 0) {
    console.log('[BANXICO] No datos in series')
    return null
  }

  console.log('[BANXICO] Parsing', observations.length, 'observations, titulo:', series.titulo)

  const table: string[][] = []
  table.push(['Fecha', 'Valor', 'Serie', 'Titulo'])

  for (const obs of observations) {
    table.push([obs.fecha, obs.dato, series.idSerie, series.titulo])
  }

  const csv = table.map((row) => row.map(cell => `"${cell}"`).join(',')).join('\n')

  return { table, csv }
}