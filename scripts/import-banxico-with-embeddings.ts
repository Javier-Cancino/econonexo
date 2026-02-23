import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import { parse } from 'csv-parse/sync'
import OpenAI from 'openai'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

const voyageClient = new OpenAI({ 
  apiKey: process.env.VOYAGE_API_KEY,
  baseURL: 'https://api.voyageai.com/v1'
})

const CATALOG_PATH = '/Users/fjgc/econonexo/banxico_catalogo.csv'
const BATCH_SIZE = 50
const EMBED_BATCH = 100

async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const response = await voyageClient.embeddings.create({
    model: 'voyage-3-lite',
    input: texts,
  })
  return response.data.map(d => d.embedding)
}

async function main() {
  console.log('📖 Leyendo CSV...')
  const content = fs.readFileSync(CATALOG_PATH, 'utf-8')
  const records = parse(content, { columns: true, skip_empty_lines: true, trim: true }) as any[]
  console.log(`📊 Total registros: ${records.length}`)

  const items = records.map((r: any) => ({
    id: r.clave,
    titulo: `${r.ruta_serie} > ${r.nombre_serie}`,
  }))

  console.log('🗑️  Limpiando tabla banxico_series...')
  await prisma.$executeRaw`TRUNCATE TABLE banxico_series`

  console.log('🔄 Generando embeddings e insertando...')
  let processed = 0

  for (let i = 0; i < items.length; i += EMBED_BATCH) {
    const batch = items.slice(i, i + EMBED_BATCH)
    const texts = batch.map(item => item.titulo)

    try {
      const embeddings = await generateEmbeddings(texts)

      for (let j = 0; j < batch.length; j++) {
        const item = batch[j]
        const embedding = embeddings[j]
        const vectorString = `[${embedding.join(',')}]`

        await prisma.$executeRawUnsafe(
          `INSERT INTO banxico_series (id, titulo, embedding) VALUES ($1, $2, $3::vector) ON CONFLICT (id) DO UPDATE SET titulo = EXCLUDED.titulo, embedding = EXCLUDED.embedding`,
          item.id,
          item.titulo,
          vectorString
        )
      }

      processed += batch.length
      const pct = ((processed / items.length) * 100).toFixed(1)
      console.log(`   ✅ ${processed}/${items.length} (${pct}%)`)

      if (i + EMBED_BATCH < items.length) {
        await new Promise(r => setTimeout(r, 100))
      }
    } catch (error) {
      console.error(`Error en batch ${i}:`, error)
    }
  }

  console.log('\n✅ Importación completada')
  const count = await prisma.banxicoSerie.count()
  console.log(`📊 Total en DB: ${count}`)

  const test = await prisma.$queryRaw<any[]>`
    SELECT id, titulo FROM banxico_series WHERE id = 'SF43718'
  `
  if (test.length > 0) {
    console.log('✅ SF43718 verificado:', test[0].titulo)
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
