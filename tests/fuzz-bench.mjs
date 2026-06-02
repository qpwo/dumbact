import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, readlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = readFileSync(join(root, 'dumbact.js'), 'utf8').replaceAll('</script>', '<\\/script>');

function browserWorks(path) {
  if (!path || !existsSync(path)) return false;
  const r = spawnSync(path, ['--version'], { encoding: 'utf8' });
  return r.status === 0;
}
function findChromium() {
  const paths = [
    process.env.CHROMIUM_PATH,
    ...['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'chrome'].map(name => spawnSync('which', [name], { encoding: 'utf8' }).stdout.trim()).filter(Boolean),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ];
  for (const path of paths) if (browserWorks(path)) return path;
  return paths.find(Boolean) || '/usr/bin/chromium';
}
function row(k, v) { return `| ${k} | ${v} |`; }
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function closeSoon(task, ms = 4000) { try { await Promise.race([task, delay(ms)]); } catch (_) {} }
async function cleanupChromiumLeftovers() {
  let entries = [];
  try { entries = readdirSync('/proc'); } catch (_) { return; }
  const victims = [];
  for (const pid of entries) {
    if (!/^\d+$/.test(pid) || Number(pid) === process.pid) continue;
    let cmd = '';
    try { cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' '); } catch (_) { continue; }
    if (/playwright_chromiumdev_profile|chrome_crashpad_handler/.test(cmd)) victims.push(Number(pid));
    else {
      for (const fd of ['1', '2']) {
        try {
          const own = readlinkSync(`/proc/self/fd/${fd}`);
          const other = readlinkSync(`/proc/${pid}/fd/${fd}`);
          if (own === other && /chrome_crashpad_handler|(^|\/)(chromium|chrome)(\s|$)/.test(cmd)) victims.push(Number(pid));
        } catch (_) {}
      }
    }
  }
  for (const pid of [...new Set(victims)]) { try { process.kill(pid, 'SIGTERM'); } catch (_) {} }
  if (victims.length) await delay(120);
  for (const pid of [...new Set(victims)]) { try { process.kill(pid, 0); process.kill(pid, 'SIGKILL'); } catch (_) {} }
}

const chromiumPath = findChromium();
const chromiumArgs = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-software-rasterizer', '--disable-crash-reporter', '--disable-breakpad'];
assert.ok(existsSync(chromiumPath), 'missing Chromium at ' + chromiumPath);

async function resetPage(page, errors) {
  errors.length = 0;
  await page.setContent(`<!doctype html><meta charset="utf-8"><main id="app"></main><main id="direct"></main><script>${runtime}</script>`);
}

async function runFuzz(page, errors) {
  await resetPage(page, errors);
  try {
    const result = await page.evaluate(async () => {
      const seed0 = 0x5eed1234;
      let seed = seed0 >>> 0;
      function rand() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; }
      function id(n) { return 'k' + n; }
      let nextId = 40;
      let items = Array.from({ length: 40 }, (_, i) => ({ id: id(i), text: 'item ' + i }));
      const root = document.getElementById('app');
      function App() {
        const list = Dumbact.get('fuzz:items', []);
        return Dumbact.h('ul', { id: 'list' }, list.map(item => Dumbact.h('li', {
          key: item.id,
          'data-id': item.id,
          onClick: () => Dumbact.set('fuzz:last-click', item.id)
        }, item.text)));
      }
      function nodes() { return Array.from(document.querySelectorAll('#list > li')); }
      function domIds() { return nodes().map(n => n.getAttribute('data-id')); }
      function assertDom(step) {
        const got = domIds().join('|');
        const want = items.map(x => x.id).join('|');
        if (got !== want) throw new Error('order mismatch at step ' + step + '\nwant ' + want + '\ngot  ' + got);
        const text = nodes().map(n => n.textContent).join('|');
        const textWant = items.map(x => x.text).join('|');
        if (text !== textWant) throw new Error('text mismatch at step ' + step);
      }
      Dumbact.set('fuzz:items', items);
      Dumbact.render(App, root);
      Dumbact.flush();
      assertDom(0);
      let map = new Map(nodes().map(n => [n.getAttribute('data-id'), n]));
      let operations = 0;
      for (let step = 1; step <= 320; step++) {
        const previous = map;
        const op = Math.floor(rand() * 8);
        if (op === 0 && items.length) {
          const i = Math.floor(rand() * items.length);
          items = items.filter((_, index) => index !== i);
        } else if (op === 1) {
          const item = { id: id(nextId++), text: 'item ' + nextId };
          const i = Math.floor(rand() * (items.length + 1));
          items = items.slice(0, i).concat(item, items.slice(i));
        } else if (op === 2 && items.length) {
          const i = Math.floor(rand() * items.length);
          items = items.map((x, index) => index === i ? { id: x.id, text: x.text + '!' } : x);
        } else if (op === 3) {
          items = items.slice().reverse();
        } else if (op === 4 && items.length > 1) {
          const a = Math.floor(rand() * items.length);
          const b = Math.floor(rand() * items.length);
          items = items.slice();
          const t = items[a]; items[a] = items[b]; items[b] = t;
        } else if (op === 5) {
          items = items.slice().sort((a, b) => a.id.localeCompare(b.id));
        } else if (op === 6) {
          items = items.slice(0, Math.min(items.length, 80));
        } else {
          while (items.length < 50) items.push({ id: id(nextId++), text: 'item ' + nextId });
        }
        Dumbact.set('fuzz:items', items);
        await Promise.resolve();
        Dumbact.flush();
        assertDom(step);
        map = new Map(nodes().map(n => [n.getAttribute('data-id'), n]));
        for (const item of items) {
          if (previous.has(item.id) && previous.get(item.id) !== map.get(item.id)) throw new Error('keyed node was replaced for ' + item.id + ' at step ' + step);
        }
        operations++;
      }
      if (items.length) {
        nodes()[0].click();
        await Promise.resolve(); Dumbact.flush();
        if (Dumbact.peek('fuzz:last-click') !== items[0].id) throw new Error('latest keyed click handler failed');
      }
      Dumbact.clear('event:');
      let sum = 0;
      function Button() {
        const value = Dumbact.get('event:value', 1);
        return Dumbact.h('button', { id: 'event-button', onClick: () => { sum += value; } }, String(value));
      }
      const eventRoot = document.createElement('section');
      document.body.appendChild(eventRoot);
      Dumbact.render(Button, eventRoot);
      for (let i = 1; i <= 60; i++) {
        Dumbact.set('event:value', i);
        await Promise.resolve(); Dumbact.flush();
        document.getElementById('event-button').click();
      }
      const wantSum = (60 * 61) / 2;
      if (sum !== wantSum) throw new Error('event replacement sum ' + sum + ' expected ' + wantSum);
      let renders = 0;
      const tmp = document.createElement('aside');
      document.body.appendChild(tmp);
      function Temp() { renders++; return Dumbact.h('span', null, Dumbact.get('dead:value', 0)); }
      Dumbact.render(Temp, tmp);
      Dumbact.unmount(tmp);
      Dumbact.set('dead:value', 1);
      await Promise.resolve(); Dumbact.flush();
      if (renders !== 1 || tmp.childNodes.length !== 0) throw new Error('unmount left live view behind');
      return { seed: '0x' + seed0.toString(16), operations, finalLength: items.length, eventSum: sum };
    });
    assert.deepEqual(errors, [], errors.join('\n'));
    return result;
  } finally {
  }
}

async function runBench(page, errors) {
  await resetPage(page, errors);
  try {
    const result = await page.evaluate(async () => {
      function sample(fn, n = 9) {
        const out = [];
        for (let i = 0; i < n; i++) {
          const t0 = performance.now();
          fn();
          out.push(performance.now() - t0);
        }
        out.sort((a, b) => a - b);
        return { median: out[Math.floor(out.length / 2)], min: out[0], max: out[out.length - 1] };
      }
      function ms(x) { return Math.round(x * 100) / 100; }
      const N = 1200;
      const app = document.getElementById('app');
      const direct = document.getElementById('direct');
      let items = Array.from({ length: N }, (_, i) => ({ id: 'row-' + i, label: 'Row ' + i }));
      function List() {
        const list = Dumbact.get('bench:items', []);
        return Dumbact.h('ul', null, list.map(item => Dumbact.h('li', { key: item.id, 'data-id': item.id }, item.label)));
      }
      const directInitial = sample(() => {
        direct.textContent = '';
        const ul = document.createElement('ul');
        for (const item of items) {
          const li = document.createElement('li');
          li.setAttribute('data-id', item.id);
          li.textContent = item.label;
          ul.appendChild(li);
        }
        direct.appendChild(ul);
      });
      const dumbactInitial = sample(() => {
        Dumbact.unmount(app);
        Dumbact.set('bench:items', items);
        Dumbact.render(List, app);
        Dumbact.flush();
      });
      Dumbact.unmount(app);
      Dumbact.set('bench:items', items);
      Dumbact.render(List, app);
      Dumbact.flush();
      const singleTextUpdate = sample(() => {
        const i = Math.floor(Math.random() * N);
        items = items.map((x, idx) => idx === i ? { id: x.id, label: x.label + '.' } : x);
        Dumbact.set('bench:items', items);
        Dumbact.flush();
      });
      const keyedReverse = sample(() => {
        items = items.slice().reverse();
        Dumbact.set('bench:items', items);
        Dumbact.flush();
      });
      const append100 = sample(() => {
        const base = items.length;
        items = items.concat(Array.from({ length: 100 }, (_, i) => ({ id: 'new-' + base + '-' + i + '-' + Math.random(), label: 'New ' + i })));
        Dumbact.set('bench:items', items);
        Dumbact.flush();
        items = items.slice(0, N);
        Dumbact.set('bench:items', items);
        Dumbact.flush();
      }, 7);
      return {
        environment: navigator.userAgent,
        N,
        directInitial: { median: ms(directInitial.median), min: ms(directInitial.min), max: ms(directInitial.max) },
        dumbactInitial: { median: ms(dumbactInitial.median), min: ms(dumbactInitial.min), max: ms(dumbactInitial.max) },
        singleTextUpdate: { median: ms(singleTextUpdate.median), min: ms(singleTextUpdate.min), max: ms(singleTextUpdate.max) },
        keyedReverse: { median: ms(keyedReverse.median), min: ms(keyedReverse.min), max: ms(keyedReverse.max) },
        append100: { median: ms(append100.median), min: ms(append100.min), max: ms(append100.max) }
      };
    });
    assert.deepEqual(errors, [], errors.join('\n'));
    assert.ok(result.dumbactInitial.median < 1000, 'initial render too slow: ' + result.dumbactInitial.median + 'ms');
    assert.ok(result.singleTextUpdate.median < 1000, 'update too slow: ' + result.singleTextUpdate.median + 'ms');
    assert.ok(result.keyedReverse.median < 1000, 'reverse too slow: ' + result.keyedReverse.median + 'ms');
    const lines = [
      '# Benchmark results',
      '',
      'These numbers are produced by `npm run test:bench` or `npm test` in Chromium on this machine. They are not universal performance claims. They are a reproducible smoke benchmark that catches obvious regressions.',
      '',
      '| case | median / min / max |',
      '|---|---|',
      row('rows', String(result.N)),
      row('direct DOM initial render', `${result.directInitial.median} / ${result.directInitial.min} / ${result.directInitial.max} ms`),
      row('Dumbact initial render', `${result.dumbactInitial.median} / ${result.dumbactInitial.min} / ${result.dumbactInitial.max} ms`),
      row('Dumbact single text update', `${result.singleTextUpdate.median} / ${result.singleTextUpdate.min} / ${result.singleTextUpdate.max} ms`),
      row('Dumbact keyed reverse', `${result.keyedReverse.median} / ${result.keyedReverse.min} / ${result.keyedReverse.max} ms`),
      row('Dumbact append 100', `${result.append100.median} / ${result.append100.min} / ${result.append100.max} ms`),
      '',
      'Browser:',
      '',
      '```',
      result.environment,
      '```',
      ''
    ];
    writeFileSync(join(root, 'BENCHMARK.md'), lines.join('\n'));
    return result;
  } finally {
  }
}

async function runOnce() {
  const browser = await chromium.launch({ executablePath: chromiumPath, args: chromiumArgs });
  const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.stack || e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  try {
    const bench = await runBench(page, errors);
    const fuzz = await runFuzz(page, errors);
    return { bench, fuzz };
  } finally {
    await closeSoon(page.close());
    await closeSoon(browser.close());
    await cleanupChromiumLeftovers();
  }
}

let result;
let lastError;
for (let attempt = 1; attempt <= 4; attempt++) {
  try {
    result = await runOnce();
    break;
  } catch (e) {
    lastError = e;
    await cleanupChromiumLeftovers();
    await delay(700 * attempt);
  }
}
if (!result) throw lastError;

const { fuzz, bench } = result;
console.log(`browser fuzz passed seed=${fuzz.seed} operations=${fuzz.operations} finalLength=${fuzz.finalLength} eventSum=${fuzz.eventSum}`);
console.log(`benchmark passed rows=${bench.N} dumbactInitial=${bench.dumbactInitial.median}ms update=${bench.singleTextUpdate.median}ms reverse=${bench.keyedReverse.median}ms`);
process.exit(0);
