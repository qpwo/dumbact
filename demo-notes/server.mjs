import express from 'express'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const app = express(),
  port = Number(process.env.PORT || 7307)
let next = 3
let notes = [
  { id: '1', text: 'Server note: explicit data beats lifecycle folklore.' },
  { id: '2', text: 'No prop-drilling gremlin required.' }
]
function clientHtml() {
  return readFileSync(join(here, 'index.html'), 'utf8').replace('../dumbact.js', '/dumbact.js')
}
app.disable('x-powered-by')
app.use(express.json({ limit: '32kb' }))
app.use((req, res, nextFn) => {
  res.set('access-control-allow-origin', '*')
  res.set('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS')
  res.set('access-control-allow-headers', 'content-type')
  res.set('access-control-allow-private-network', 'true')
  if (req.method === 'OPTIONS') return res.status(204).end()
  nextFn()
})
app.get('/api/health', (_req, res) => res.json({ ok: true }))
app.get('/dumbact.js', (_req, res) =>
  res.type('application/javascript').send(readFileSync(join(root, 'dumbact.js'), 'utf8'))
)
app.get('/', (_req, res) => res.type('html').send(clientHtml()))
app.get('/api/notes', (_req, res) => res.json(notes))
app.post('/api/notes', (req, res) => {
  const text = String(req.body?.text || '').trim()
  if (!text) return res.status(400).json({ error: 'text required' })
  const note = { id: String(next++), text }
  notes = [note, ...notes].slice(0, 40)
  res.status(201).json(note)
})
app.delete('/api/notes/:id', (req, res) => {
  notes = notes.filter(n => n.id !== req.params.id)
  res.status(204).end()
})
app.listen(port, () => console.log(`notes http://127.0.0.1:${port}`))
