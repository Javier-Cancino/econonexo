import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import { parse } from 'csv-parse/sync'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function importBanxicoCatalog() {
  console.log('🔄 Importando catálogo de Banxico...')
  
  const csvPath = '/Users/fjgc/econonexo/banxico_catalogo.csv'
  const fileContent = fs.readFileSync(csvPath, 'utf-8')
  
  const records = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  })
  
  console.log(`📊 Total de registros en CSV: ${records.length}`)
  
  const transformed = records.map((row: any) => ({
    id: row.clave,
    titulo: `${row.ruta_serie} > ${row.nombre_serie}`,
  }))
  
  const existingCount = await prisma.banxicoSerie.count()
  console.log(`📦 Registros actuales en DB: ${existingCount}`)
  
  console.log('🗑️  Eliminando registros actuales...')
  await prisma.banxicoSerie.deleteMany({})
  
  console.log('📥 Insertando nuevos registros...')
  const batchSize = 1000
  let inserted = 0
  
  for (let i = 0; i < transformed.length; i += batchSize) {
    const batch = transformed.slice(i, i + batchSize)
    await prisma.banxicoSerie.createMany({
      data: batch,
      skipDuplicates: true,
    })
    inserted += batch.length
    process.stdout.write(`\r   Insertados: ${inserted}/${transformed.length}`)
  }
  console.log('')
  
  console.log('✅ Importación completada')
  
  const finalCount = await prisma.banxicoSerie.count()
  console.log(`📊 Total registros en DB: ${finalCount}`)
  
  const testSerie = await prisma.banxicoSerie.findUnique({
    where: { id: 'SF43718' }
  })
  
  if (testSerie) {
    console.log('✅ Verificación exitosa - SF43718 encontrado:')
    console.log(`   ${testSerie.titulo}`)
  } else {
    console.log('❌ Error: SF43718 no encontrado después de importar')
  }
}

importBanxicoCatalog()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
