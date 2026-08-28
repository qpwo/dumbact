import express from 'express'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const app = express()
const port = Number(process.env.PORT || 7314)
let next = 5
let items = [
  { id: 'oats', name: 'Oats', aisle: 'pantry', price: 4.2, done: false },
  { id: 'apples', name: 'Apples', aisle: 'produce', price: 5.5, done: false },
  { id: 'yogurt', name: 'Yogurt', aisle: 'dairy', price: 3.8, done: true },
  { id: 'lentils', name: 'Lentils', aisle: 'pantry', price: 2.9, done: false }
]

function cleanText(value) {
  return String(value || '')
    .trim()
    .slice(0, 80)
}

function makeItem(name) {
  return { id: String(next++), name, aisle: 'misc', price: 3.5, done: false }
}

app.disable('x-powered-by')
app.use(express.json({ limit: '32kb' }))
app.use((req, res, nextFn) => {
  res.set('access-control-allow-origin', '*')
  res.set('access-control-allow-methods', 'GET,POST,OPTIONS')
  res.set('access-control-allow-headers', 'content-type')
  res.set('access-control-allow-private-network', 'true')
  if (req.method === 'OPTIONS') return res.status(204).end()
  nextFn()
})
app.get('/api/health', (_req, res) => res.json({ ok: true }))
app.get('/dumbact.js', (_req, res) =>
  res.type('application/javascript').send(readFileSync(join(root, 'dumbact.js'), 'utf8'))
)
app.use(express.static(here))
app.get('/api/items', (_req, res) => res.json(items))
app.post('/api/items', (req, res) => {
  const name = cleanText(req.body?.name)
  if (!name) return res.status(400).json({ error: 'name required' })
  const item = makeItem(name)
  items = [item].concat(items).slice(0, 60)
  res.status(201).json(item)
})
app.post('/api/items/:id/toggle', (req, res) => {
  let found = null
  items = items.map(item => {
    if (item.id !== req.params.id) return item
    found = { ...item, done: !item.done }
    return found
  })
  if (!found) return res.status(404).json({ error: 'item not found' })
  res.json(found)
})
app.listen(port, () => console.log(`demo-grocery http://127.0.0.1:${port}`))
