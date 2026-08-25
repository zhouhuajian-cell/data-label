import mysql from 'mysql2/promise'
import { config } from './server/config.js'

const pool = mysql.createPool({
  host: config.db.host, port: config.db.port,
  user: config.db.user, password: config.db.password,
  database: config.db.database, charset: 'utf8mb4'
})

const [rows] = await pool.query('SELECT name, data FROM app_state WHERE name IN (?, ?)', ['users', 'gndUsers'])
for (const r of rows) {
  console.log('====', r.name, '====')
  const data = typeof r.data === 'string' ? JSON.parse(r.data) : r.data
  console.log(JSON.stringify(data, null, 2))
}
await pool.end()
