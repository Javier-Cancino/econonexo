import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

interface InegiIndicator {
  id: string
  descripcion: string
}

interface BanxicoSerie {
  id: string
  titulo: string
}

let inegiCatalog: InegiIndicator[] | null = null
let banxicoCatalog: BanxicoSerie[] | null = null

function loadInegiCatalog(): InegiIndicator[] {
  if (inegiCatalog) return inegiCatalog
  
  const filePath = path.join(process.cwd(), 'public', 'data', 'inegi-catalogo.json')
  const content = fs.readFileSync(filePath, 'utf-8')
  inegiCatalog = JSON.parse(content)
  return inegiCatalog!
}

function loadBanxicoCatalog(): BanxicoSerie[] {
  if (banxicoCatalog) return banxicoCatalog
  
  const filePath = path.join(process.cwd(), 'public', 'data', 'banxico-catalogo.json')
  const content = fs.readFileSync(filePath, 'utf-8')
  banxicoCatalog = JSON.parse(content)
  return banxicoCatalog!
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q')?.toLowerCase() || ''
  const source = searchParams.get('source') || 'inegi'
  
  if (!query) {
    return NextResponse.json({ results: [] })
  }
  
  const limit = 10
  let results: { id: string; descripcion: string }[] = []
  
  try {
    if (source === 'inegi') {
      const catalog = loadInegiCatalog()
      results = catalog
        .filter(item => item.descripcion.toLowerCase().includes(query))
        .slice(0, limit)
        .map(item => ({ id: item.id, descripcion: item.descripcion }))
    } else if (source === 'banxico') {
      const catalog = loadBanxicoCatalog()
      results = catalog
        .filter(item => item.titulo.toLowerCase().includes(query))
        .slice(0, limit)
        .map(item => ({ id: item.id, descripcion: item.titulo }))
    }
    
    return NextResponse.json({ results })
  } catch (error) {
    console.error('[SEARCH] Error:', error)
    return NextResponse.json({ results: [], error: 'Error loading catalog' })
  }
}
