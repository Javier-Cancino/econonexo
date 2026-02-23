import 'dotenv/config'
import pg from 'pg'

const db = new pg.Client({ connectionString: process.env.DATABASE_URL })
await db.connect()

const res = await db.query('SELECT key FROM "ApiKey" WHERE provider = $1 LIMIT 1', ['inegi'])

if (!res.rows.length) {
    console.log('NO KEY FOUND IN DB')
    await db.end()
    process.exit(0)
}

const token = Buffer.from(res.rows[0].key, 'base64').toString('utf-8')
console.log('Token length:', token.length)
console.log('Token preview:', token.slice(0, 8) + '...')

const url = `https://www.inegi.org.mx/app/api/indicadores/desarrolladores/jsonxml/INDICATOR/628474/es/00/false/BIE/2.0/${token}?type=json`
const r = await fetch(url)
console.log('HTTP Status:', r.status)
const body = await r.text()
console.log('Body:', body.slice(0, 400))

await db.end()

