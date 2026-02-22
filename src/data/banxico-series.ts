export const BANXICO_SERIES = [
  {
    id: 'SF43707',
    nombre: 'Reservas Internacionales',
    descripcion: 'Reservas internacionales brutas',
    unidad: 'Millones de dólares',
    frecuencia: 'Diaria',
  },
  {
    id: 'SF61745',
    nombre: 'Tasa objetivo',
    descripcion: 'Tasa de interés objetivo de Banxico',
    unidad: 'Porcentaje',
    frecuencia: 'Diaria',
  },
  {
    id: 'SF60648',
    nombre: 'TIIE a 28 días',
    descripcion: 'Tasa de Interés Interbancaria de Equilibrio a 28 días',
    unidad: 'Porcentaje',
    frecuencia: 'Diaria',
  },
  {
    id: 'SF60649',
    nombre: 'TIIE a 91 días',
    descripcion: 'Tasa de Interés Interbancaria de Equilibrio a 91 días',
    unidad: 'Porcentaje',
    frecuencia: 'Diaria',
  },
  {
    id: 'SF60633',
    nombre: 'CETES a 28 días',
    descripcion: 'Tasa de rendimiento de los CETES a 28 días',
    unidad: 'Porcentaje',
    frecuencia: 'Semanal',
  },
  {
    id: 'SF43718',
    nombre: 'Tipo de cambio FIX',
    descripcion: 'Tipo de cambio pesos por dólar - Fecha de determinación (FIX)',
    unidad: 'Pesos por dólar',
    frecuencia: 'Diaria',
  },
  {
    id: 'SF60653',
    nombre: 'Tipo de cambio fecha de liquidación',
    descripcion: 'Pesos por dólar - Fecha de liquidación',
    unidad: 'Pesos por dólar',
    frecuencia: 'Diaria',
  },
  {
    id: 'SF46410',
    nombre: 'Euro',
    descripcion: 'Tipo de cambio pesos por Euro',
    unidad: 'Pesos por Euro',
    frecuencia: 'Diaria',
  },
  {
    id: 'SF46406',
    nombre: 'Yen japonés',
    descripcion: 'Tipo de cambio pesos por Yen japonés',
    unidad: 'Pesos por Yen',
    frecuencia: 'Diaria',
  },
  {
    id: 'SF46407',
    nombre: 'Libra esterlina',
    descripcion: 'Tipo de cambio pesos por Libra esterlina',
    unidad: 'Pesos por Libra',
    frecuencia: 'Diaria',
  },
  {
    id: 'SF60632',
    nombre: 'Dólar canadiense',
    descripcion: 'Tipo de cambio pesos por Dólar canadiense',
    unidad: 'Pesos por Dólar',
    frecuencia: 'Diaria',
  },
  {
    id: 'SP68257',
    nombre: 'UDIS',
    descripcion: 'Valor de las Unidades de Inversión (UDIS)',
    unidad: 'Pesos por UDI',
    frecuencia: 'Diaria',
  },
  {
    id: 'SF223628',
    nombre: 'Tasa de fondeo bancario',
    descripcion: 'Tasa de interés de fondeo bancario',
    unidad: 'Porcentaje',
    frecuencia: 'Diaria',
  },
  {
    id: 'SF178536',
    nombre: 'Índice de precios y cotizaciones (IPC)',
    descripcion: 'Índice bursátil de la Bolsa Mexicana de Valores',
    unidad: 'Puntos',
    frecuencia: 'Diaria',
  },
  {
    id: 'SF179258',
    nombre: 'Base monetaria',
    descripcion: 'Base monetaria del Banco de México',
    unidad: 'Millones de pesos',
    frecuencia: 'Semanal',
  },
  {
    id: 'SF43783',
    nombre: 'Saldo en cuentas de cheques',
    descripcion: 'Saldo total en cuentas de cheques bancarias',
    unidad: 'Millones de pesos',
    frecuencia: 'Semanal',
  },
]

export function searchBanxicoSeries(query: string) {
  const lowerQuery = query.toLowerCase()

  return BANXICO_SERIES.filter(
    (serie) =>
      serie.nombre.toLowerCase().includes(lowerQuery) ||
      serie.descripcion.toLowerCase().includes(lowerQuery) ||
      serie.id.toLowerCase().includes(lowerQuery)
  )
}