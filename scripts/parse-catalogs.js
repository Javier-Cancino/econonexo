const fs = require('fs')
const path = require('path')
const XLSX = require('xlsx')

const PUBLIC_DATA_DIR = path.join(__dirname, '..', 'public', 'data')

function parseBanxicoCSV() {
  console.log('Parsing Banxico catalog...')
  
  const csvPath = path.join(__dirname, '..', 'banxico_catalogo.csv')
  const content = fs.readFileSync(csvPath, 'utf-8')
  const lines = content.split('\n').filter(l => l.trim())
  
  const results = []
  const seen = new Set()
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    const commaIndex = line.lastIndexOf(',')
    if (commaIndex === -1) continue
    
    const clave = line.substring(commaIndex + 1).trim().replace(/"/g, '')
    const resto = line.substring(0, commaIndex)
    
    const parts = resto.split(',')
    const nombre = parts[parts.length - 1]?.trim().replace(/"/g, '') || ''
    
    if (clave && nombre && !seen.has(clave)) {
      seen.add(clave)
      results.push({ id: clave, titulo: nombre })
    }
  }
  
  console.log(`  Found ${results.length} Banxico series`)
  return results
}

function parseInegiXLSX() {
  console.log('Parsing INEGI catalog...')
  
  const xlsxPath = path.join(__dirname, '..', 'BIE_equivalencias.xlsx')
  
  const workbook = XLSX.readFile(xlsxPath)
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 })
  
  if (!rows || rows.length === 0) {
    console.log('  No data found in XLSX')
    return []
  }
  
  const header = rows[0]
  const idBieIdx = header.findIndex(h => String(h).includes('ID BIE') || String(h).includes('ID_NUEVO'))
  const rutaIdx = header.findIndex(h => String(h).includes('RUTA'))
  
  console.log(`  Header columns: ${header.slice(0, 10).map(h => String(h).substring(0, 20)).join(', ')}`)
  console.log(`  ID column index: ${idBieIdx}, RUTA index: ${rutaIdx}`)
  
  const results = []
  const seen = new Set()
  
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    const id = String(row[idBieIdx] || '').trim()
    const ruta = String(row[rutaIdx] || '').trim()
    
    if (id && !seen.has(id)) {
      seen.add(id)
      results.push({ id, descripcion: ruta || `Indicador ${id}` })
    }
  }
  
  console.log(`  Found ${results.length} INEGI indicators`)
  return results
}

function main() {
  console.log('=== Parsing catalogs ===\n')
  
  if (!fs.existsSync(PUBLIC_DATA_DIR)) {
    fs.mkdirSync(PUBLIC_DATA_DIR, { recursive: true })
  }
  
  const banxicoData = parseBanxicoCSV()
  fs.writeFileSync(
    path.join(PUBLIC_DATA_DIR, 'banxico-catalogo.json'),
    JSON.stringify(banxicoData, null, 2)
  )
  console.log(`  Saved to public/data/banxico-catalogo.json\n`)
  
  const inegiData = parseInegiXLSX()
  fs.writeFileSync(
    path.join(PUBLIC_DATA_DIR, 'inegi-catalogo.json'),
    JSON.stringify(inegiData, null, 2)
  )
  console.log(`  Saved to public/data/inegi-catalogo.json\n`)
  
  console.log('=== Done ===')
}

main()
