import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use(express.static(__dirname, { extensions: ['html'] }));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Dumbact static demo server: http://127.0.0.1:${port}/`);
  console.log(`Module graph demo: http://127.0.0.1:${port}/demos/11-module-graph-tsx.html`);
});
