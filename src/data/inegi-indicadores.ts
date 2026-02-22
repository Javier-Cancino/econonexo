export const INEGI_INDICADORES = [
  {
    id: '1002000001',
    nombre: 'Población total',
    tema: 'Población',
    unidad: 'Personas',
    frecuencia: 'Anual',
  },
  {
    id: '1002000002',
    nombre: 'Población masculina',
    tema: 'Población',
    unidad: 'Personas',
    frecuencia: 'Anual',
  },
  {
    id: '1002000003',
    nombre: 'Población femenina',
    tema: 'Población',
    unidad: 'Personas',
    frecuencia: 'Anual',
  },
  {
    id: '444456',
    nombre: 'PIB (Producto Interno Bruto) a precios constantes',
    tema: 'Cuentas Nacionales',
    unidad: 'Millones de pesos',
    frecuencia: 'Trimestral',
  },
  {
    id: '444457',
    nombre: 'PIB (Producto Interno Bruto) a precios corrientes',
    tema: 'Cuentas Nacionales',
    unidad: 'Millones de pesos',
    frecuencia: 'Trimestral',
  },
  {
    id: '5264721',
    nombre: 'INPC (Índice Nacional de Precios al Consumidor)',
    tema: 'Precios',
    unidad: 'Índice',
    frecuencia: 'Mensual',
  },
  {
    id: '5264722',
    nombre: 'Inflación anual INPC',
    tema: 'Precios',
    unidad: 'Porcentaje',
    frecuencia: 'Mensual',
  },
  {
    id: '289237',
    nombre: 'Tasa de desocupación',
    tema: 'Mercado Laboral',
    unidad: 'Porcentaje',
    frecuencia: 'Mensual',
  },
  {
    id: '289238',
    nombre: 'Población económicamente activa',
    tema: 'Mercado Laboral',
    unidad: 'Personas',
    frecuencia: 'Mensual',
  },
  {
    id: '289239',
    nombre: 'Población ocupada',
    tema: 'Mercado Laboral',
    unidad: 'Personas',
    frecuencia: 'Mensual',
  },
  {
    id: '575213',
    nombre: 'Índice de volumen físico de la actividad industrial',
    tema: 'Actividad Económica',
    unidad: 'Índice',
    frecuencia: 'Mensual',
  },
  {
    id: '575214',
    nombre: 'IGAE (Indicador Global de la Actividad Económica)',
    tema: 'Actividad Económica',
    unidad: 'Índice',
    frecuencia: 'Mensual',
  },
  {
    id: '575234',
    nombre: 'Indicador de actividad económica del sector terciario',
    tema: 'Actividad Económica',
    unidad: 'Índice',
    frecuencia: 'Mensual',
  },
  {
    id: '575235',
    nombre: 'Indicador de actividad económica del sector secundario',
    tema: 'Actividad Económica',
    unidad: 'Índice',
    frecuencia: 'Mensual',
  },
  {
    id: '389336',
    nombre: 'Índice de confianza del consumidor',
    tema: 'Expectativas',
    unidad: 'Puntos',
    frecuencia: 'Mensual',
  },
  {
    id: '389337',
    nombre: 'Índice de confianza del productor',
    tema: 'Expectativas',
    unidad: 'Puntos',
    frecuencia: 'Mensual',
  },
  {
    id: '5303789',
    nombre: 'Exportaciones totales',
    tema: 'Comercio Exterior',
    unidad: 'Millones de dólares',
    frecuencia: 'Mensual',
  },
  {
    id: '5303790',
    nombre: 'Importaciones totales',
    tema: 'Comercio Exterior',
    unidad: 'Millones de dólares',
    frecuencia: 'Mensual',
  },
  {
    id: '620686890',
    nombre: 'Inversión extranjera directa',
    tema: 'Comercio Exterior',
    unidad: 'Millones de dólares',
    frecuencia: 'Trimestral',
  },
  {
    id: '531217',
    nombre: 'Remesas totales',
    tema: 'Sector Externo',
    unidad: 'Millones de dólares',
    frecuencia: 'Mensual',
  },
]

export function searchInegiIndicadores(query: string) {
  const lowerQuery = query.toLowerCase()

  return INEGI_INDICADORES.filter(
    (ind) =>
      ind.nombre.toLowerCase().includes(lowerQuery) ||
      ind.tema.toLowerCase().includes(lowerQuery) ||
      ind.id.includes(query)
  )
}