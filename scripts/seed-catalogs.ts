import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('Cargando catálogo INEGI...')
  const inegiRaw = fs.readFileSync(
    path.join(__dirname, '../public/data/inegi-catalogo.json'), 'utf-8'
  )
  const inegiData: { id: string; descripcion: string }[] = JSON.parse(inegiRaw)
  
  const inegiChunks = []
  for (let i = 0; i < inegiData.length; i += 1000) {
    inegiChunks.push(inegiData.slice(i, i + 1000))
  }
  
  await prisma.inegiIndicador.deleteMany()
  for (const chunk of inegiChunks) {
    await prisma.inegiIndicador.createMany({ data: chunk, skipDuplicates: true })
    process.stdout.write('.')
  }
  console.log(`\nINEGI: ${inegiData.length} indicadores cargados`)

  console.log('Cargando catálogo Banxico...')
  const banxicoRaw = fs.readFileSync(
    path.join(__dirname, '../public/data/banxico-catalogo.json'), 'utf-8'
  )
  const banxicoData: { id: string; titulo: string }[] = JSON.parse(banxicoRaw)
  
  const banxicoChunks = []
  for (let i = 0; i < banxicoData.length; i += 1000) {
    banxicoChunks.push(banxicoData.slice(i, i + 1000))
  }
  
  await prisma.banxicoSerie.deleteMany()
  for (const chunk of banxicoChunks) {
    await prisma.banxicoSerie.createMany({ data: chunk, skipDuplicates: true })
    process.stdout.write('.')
  }
  console.log(`\nBanxico: ${banxicoData.length} series cargadas`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
