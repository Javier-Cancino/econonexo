const SHCP_DATA_URLS = {
  deuda_publica:
    'https://repodatos.atdt.gob.mx/s_hacienda_cred_publico/indicadores_fiscales/deuda_publica.csv',
  ingreso_gasto:
    'https://repodatos.atdt.gob.mx/s_hacienda_cred_publico/indicadores_fiscales/ingreso_gasto_finan.csv',
  transferencias:
    'https://repodatos.atdt.gob.mx/s_hacienda_cred_publico/indicadores_fiscales/transferencias_entidades_fed.csv',
  rfsp:
    'https://repodatos.atdt.gob.mx/s_hacienda_cred_publico/indicadores_fiscales/rfsp.csv',
  deuda_amplia:
    'https://repodatos.atdt.gob.mx/s_hacienda_cred_publico/indicadores_fiscales/shrfsp_deuda_amplia_actual.csv',
}

export type SHCPDataset = keyof typeof SHCP_DATA_URLS

export const SHCP_DATASET_NAMES: Record<SHCPDataset, string> = {
  deuda_publica: 'Deuda Pública',
  ingreso_gasto: 'Ingreso, Gasto y Financiamiento Público',
  transferencias: 'Transferencias a Entidades Federativas',
  rfsp: 'Requerimientos Financieros del Sector Público',
  deuda_amplia: 'Saldo Histórico RFSP (Deuda Amplia)',
}

export const SHCP_DATASETS = [
  { id: 'deuda_publica' as SHCPDataset, name: 'Deuda Pública', description: 'Indicadores de deuda pública' },
  { id: 'ingreso_gasto' as SHCPDataset, name: 'Ingreso, Gasto y Financiamiento Público', description: 'Balances, ingresos y gastos' },
  { id: 'transferencias' as SHCPDataset, name: 'Transferencias a Entidades Federativas', description: 'Transferencias federales' },
  { id: 'rfsp' as SHCPDataset, name: 'Requerimientos Financieros del Sector Público', description: 'RFSP' },
  { id: 'deuda_amplia' as SHCPDataset, name: 'Saldo Histórico RFSP', description: 'Deuda amplia' },
]

export function searchSHCPDataset(query: string) {
  const lower = query.toLowerCase()
  return SHCP_DATASETS.filter(
    d => d.name.toLowerCase().includes(lower) ||
         d.description.toLowerCase().includes(lower) ||
         d.id.includes(lower)
  )
}

export async function fetchSHCPData(dataset: SHCPDataset): Promise<string | null> {
  const url = SHCP_DATA_URLS[dataset]

  try {
    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(`SHCP data fetch error: ${response.status}`)
    }

    const csvText = await response.text()
    return csvText
  } catch (error) {
    console.error('Error fetching SHCP data:', error)
    return null
  }
}

export function parseSHCPData(
  csvText: string,
  filters?: {
    column?: string
    value?: string
    limit?: number
  }
): { table: string[][]; csv: string } {
  const lines = csvText.trim().split('\n')

  if (lines.length === 0) {
    return { table: [], csv: '' }
  }

  const parsedLines = lines.map((line) =>
    line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, ''))
  )

  let filteredLines = parsedLines

  if (filters?.column && filters?.value) {
    const header = parsedLines[0]
    const colIndex = header.findIndex(
      (h) => h.toLowerCase() === filters.column!.toLowerCase()
    )

    if (colIndex !== -1) {
      filteredLines = [
        header,
        ...parsedLines.slice(1).filter((row) =>
          row[colIndex]?.toLowerCase().includes(filters.value!.toLowerCase())
        ),
      ]
    }
  }

  const limit = filters?.limit || 100
  const limitedLines = filteredLines.slice(0, limit + 1)

  const csv = limitedLines.map((row) => row.map((c) => `"${c}"`).join(',')).join('\n')

  return { table: limitedLines, csv }
}

export function findSHCPDataset(query: string): SHCPDataset | null {
  const queryLower = query.toLowerCase()

  if (queryLower.includes('deuda') && !queryLower.includes('amplia')) {
    return 'deuda_publica'
  }
  if (queryLower.includes('ingreso') || queryLower.includes('gasto') || queryLower.includes('financiamiento')) {
    return 'ingreso_gasto'
  }
  if (queryLower.includes('transferencia') || queryLower.includes('entidades federativas')) {
    return 'transferencias'
  }
  if (queryLower.includes('rfsp') || queryLower.includes('requerimiento financiero')) {
    return 'rfsp'
  }
  if (queryLower.includes('deuda amplia') || queryLower.includes('saldo histórico')) {
    return 'deuda_amplia'
  }

  return null
}