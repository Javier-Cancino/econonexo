import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import OpenAI from 'openai'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

const voyageClient = new OpenAI({
  apiKey: process.env.VOYAGE_API_KEY,
  baseURL: 'https://api.voyageai.com/v1'
})

const BATCH_SIZE = 100

async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const response = await voyageClient.embeddings.create({
    model: 'voyage-3-lite',
    input: texts,
  })
  return response.data.map(d => d.embedding)
}

async function processTable(table: string, textCol: string) {
  console.log(`\n📊 Procesando ${table}...`)
  
  const countResult = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*) as count FROM ${prisma.$queryRawUnsafe(table)} WHERE embedding IS NULL
  `
  const total = Number(countResult[0].count)
  console.log(`   Registros sin embedding: ${total}`)
  
  if (total === 0) {
    console.log(`   ✅ Todos los registros ya tienen embedding`)
    return
  }
  
  let processed = 0
  
  while (processed < total) {
    const rows = await prisma.$queryRaw<{ id: string; text: string }[]>`
      SELECT id, ${prisma.$queryRawUnsafe(textCol)} as text 
      FROM ${prisma.$queryRawUnsafe(table)} 
      WHERE embedding IS NULL 
      LIMIT ${BATCH_SIZE}
    `
    
    if (rows.length === 0) break
    
    const texts = rows.map(r => r.text)
    const embeddings = await generateEmbeddings(texts)
    
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const embedding = embeddings[i]
      const vectorString = `[${embedding.join(',')}]`
      
      await prisma.$executeRawUnsafe(
        `UPDATE ${table} SET embedding = $1::vector WHERE id = $2`,
        vectorString,
        row.id
      )
    }
    
    processed += rows.length
    const pct = ((processed / total) * 100).toFixed(1)
    console.log(`   Procesados: ${processed}/${total} (${pct}%)`)
    
    await new Promise(r => setTimeout(r, 100))
  }
  
  console.log(`   ✅ ${table} completado`)
}

async function main() {
  if (!process.env.VOYAGE_API_KEY) {
    console.error('❌ VOYAGE_API_KEY no está configurada')
    process.exit(1)
  }
  
  console.log('🚀 Generando embeddings con Voyage AI...')
  
  await processTable('banxico_series', 'titulo')
  await processTable('inegi_indicadores', 'descripcion')
  
  console.log('\n✅ Proceso completado')
  
  const banxicoCount = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*) as count FROM banxico_series WHERE embedding IS NOT NULL
  `
  const inegiCount = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*) as count FROM inegi_indicadores WHERE embedding IS NOT NULL
  `
  
  console.log(`\n📊 Resumen:`)
  console.log(`   banxico_series: ${Number(banxicoCount[0].count)} con embedding`)
  console.log(`   inegi_indicadores: ${Number(inegiCount[0].count)} con embedding`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
