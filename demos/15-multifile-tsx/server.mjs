import express from 'express';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const app = express();
const port = Number(process.env.PORT || 7315);
let next = 4;
let jobs = [
  { id: 'brake', title: 'Brake tune', owner: 'Mina', status: 'todo', minutes: 35 },
  { id: 'chain', title: 'Chain clean', owner: 'Owen', status: 'doing', minutes: 20 },
  { id: 'rack', title: 'Rear rack install', owner: 'Iris', status: 'done', minutes: 45 }
];

function cleanText(value) {
  return String(value || '').trim().slice(0, 90);
}

function makeJob(title) {
  return { id: String(next++), title, owner: 'walk-in', status: 'todo', minutes: 25 };
}

function nextStatus(status) {
  if (status === 'todo') return 'doing';
  if (status === 'doing') return 'done';
  return 'todo';
}

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use((req, res, nextFn) => {
  res.set('access-control-allow-origin', '*');
  res.set('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.set('access-control-allow-headers', 'content-type');
  res.set('access-control-allow-private-network', 'true');
  if (req.method === 'OPTIONS') return res.status(204).end();
  nextFn();
});
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/dumbact.js', (_req, res) => res.type('application/javascript').send(readFileSync(join(root, 'dumbact.js'), 'utf8')));
app.use(express.static(here));
app.get('/api/jobs', (_req, res) => res.json(jobs));
app.post('/api/jobs', (req, res) => {
  const title = cleanText(req.body?.title);
  if (!title) return res.status(400).json({ error: 'title required' });
  const job = makeJob(title);
  jobs = [job].concat(jobs).slice(0, 80);
  res.status(201).json(job);
});
app.post('/api/jobs/:id/advance', (req, res) => {
  let found = null;
  jobs = jobs.map(job => {
    if (job.id !== req.params.id) return job;
    found = { ...job, status: nextStatus(job.status) };
    return found;
  });
  if (!found) return res.status(404).json({ error: 'job not found' });
  res.json(found);
});
app.listen(port, () => console.log(`15-multifile-tsx http://127.0.0.1:${port}`));
