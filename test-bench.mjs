import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, readlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright-core'

const root = dirname(fileURLToPath(import.meta.url))
const runtime = readFileSync(join(root, 'dumbact.js'), 'utf8').replaceAll('</script>', '<\\/script>')

function browserWorks(path) {
  if (!path || !existsSync(path)) return false
  const r = spawnSync(path, ['--version'], { encoding: 'utf8' })
  return r.status === 0
}
function findChromium() {
  const paths = [
    process.env.CHROMIUM_PATH,
    ...['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'chrome']
      .map(name => spawnSync('which', [name], { encoding: 'utf8' }).stdout.trim())
      .filter(Boolean),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ]
  for (const path of paths) if (browserWorks(path)) return path
  return paths.find(Boolean) || '/usr/bin/chromium'
}
function row(k, v) {
  return `| ${k} | ${v} |`
}
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
async function closeSoon(task, ms = 4000) {
  try {
    await Promise.race([task, delay(ms)])
  } catch (_) {}
}
async function withTimeout(task, ms, label) {
  let timer
  try {
    return await Promise.race([
      task,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), ms)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}
async function cleanupChromiumPipeHolders() {
  let outs = new Set()
  try {
    outs.add(readlinkSync('/proc/self/fd/1'))
  } catch (_) {}
  try {
    outs.add(readlinkSync('/proc/self/fd/2'))
  } catch (_) {}
  outs.delete('')
  if (!outs.size) return
  let victims = []
  let entries = []
  try {
    entries = readdirSync('/proc')
  } catch (_) {
    return
  }
  for (const pid of entries) {
    if (!/^\d+$/.test(pid) || Number(pid) === process.pid) continue
    let cmd = ''
    try {
      cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ')
    } catch (_) {
      continue
    }
    if (!/(^|\/)(chromium|chrome)(\s|$)|chrome_crashpad_handler/.test(cmd)) continue
    let same = false
    for (const fd of ['1', '2']) {
      try {
        if (outs.has(readlinkSync(`/proc/${pid}/fd/${fd}`))) same = true
      } catch (_) {}
    }
    if (same) victims.push(Number(pid))
  }
  for (const pid of victims) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch (_) {}
  }
  if (victims.length) await delay(120)
  for (const pid of victims) {
    try {
      process.kill(pid, 0)
      process.kill(pid, 'SIGKILL')
    } catch (_) {}
  }
}

async function cleanupChromiumLeftovers() {
  let entries = []
  try {
    entries = readdirSync('/proc')
  } catch (_) {
    return
  }
  const victims = []
  for (const pid of entries) {
    if (!/^\d+$/.test(pid) || Number(pid) === process.pid) continue
    let cmd = ''
    try {
      cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ')
    } catch (_) {
      continue
    }
    if (/playwright_chromiumdev_profile|chrome_crashpad_handler/.test(cmd)) victims.push(Number(pid))
  }
  for (const pid of victims) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch (_) {}
  }
  if (victims.length) await delay(120)
  for (const pid of victims) {
    try {
      process.kill(pid, 0)
      process.kill(pid, 'SIGKILL')
    } catch (_) {}
  }
}
async function cleanupChromium() {
  for (let i = 0; i < 3; i++) {
    await cleanupChromiumPipeHolders()
    await cleanupChromiumLeftovers()
    await delay(120)
  }
}

const chromiumPath = findChromium()
const chromiumArgs = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-software-rasterizer',
  '--disable-crash-reporter',
  '--disable-breakpad'
]
assert.ok(existsSync(chromiumPath), 'missing Chromium at ' + chromiumPath)

async function launchPage(viewport) {
  let last
  for (let attempt = 1; attempt <= 4; attempt++) {
    let browser
    try {
      browser = await withTimeout(
        chromium.launch({ executablePath: chromiumPath, args: chromiumArgs }),
        15000,
        'chromium launch timeout'
      )
      const page = await withTimeout(browser.newPage({ viewport }), 10000, 'chromium newPage timeout')
      return { browser, page }
    } catch (e) {
      last = e
      if (browser) await closeSoon(browser.close())
      await cleanupChromium()
      await delay(500 * attempt)
    }
  }
  throw last
}
const { browser, page } = await launchPage({ width: 1200, height: 850 })
let message = ''
try {
  const errors = []
  page.on('pageerror', e => errors.push(e.stack || e.message))
  page.on('console', m => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await page.setContent(
    `<!doctype html><meta charset="utf-8"><main id="app"></main><main id="direct"></main><script>${runtime}</script>`
  )
  const result = await page.evaluate(async () => {
    function sample(fn, n = 9) {
      const out = []
      for (let i = 0; i < n; i++) {
        const t0 = performance.now()
        fn()
        out.push(performance.now() - t0)
      }
      out.sort((a, b) => a - b)
      return {
        median: out[Math.floor(out.length / 2)],
        min: out[0],
        max: out[out.length - 1]
      }
    }
    function ms(x) {
      return Math.round(x * 100) / 100
    }
    const N = 1200
    const app = document.getElementById('app')
    const direct = document.getElementById('direct')
    let items = Array.from({ length: N }, (_, i) => ({
      id: 'row-' + i,
      label: 'Row ' + i
    }))
    function List() {
      const list = Dumbact.get('bench:items', [])
      return Dumbact.h(
        'ul',
        null,
        list.map(item => Dumbact.h('li', { key: item.id, 'data-id': item.id }, item.label))
      )
    }
    const directInitial = sample(() => {
      direct.textContent = ''
      const ul = document.createElement('ul')
      for (const item of items) {
        const li = document.createElement('li')
        li.setAttribute('data-id', item.id)
        li.textContent = item.label
        ul.appendChild(li)
      }
      direct.appendChild(ul)
    })
    const dumbactInitial = sample(() => {
      Dumbact.unmount(app)
      Dumbact.set('bench:items', items)
      Dumbact.render(List, app)
      Dumbact.flush()
    })
    Dumbact.unmount(app)
    Dumbact.set('bench:items', items)
    Dumbact.render(List, app)
    Dumbact.flush()
    const singleTextUpdate = sample(() => {
      const i = Math.floor(Math.random() * N)
      items = items.map((x, idx) => (idx === i ? { id: x.id, label: x.label + '.' } : x))
      Dumbact.set('bench:items', items)
      Dumbact.flush()
    })
    const keyedReverse = sample(() => {
      items = items.slice().reverse()
      Dumbact.set('bench:items', items)
      Dumbact.flush()
    })
    const append100 = sample(() => {
      const base = items.length
      items = items.concat(
        Array.from({ length: 100 }, (_, i) => ({
          id: 'new-' + base + '-' + i + '-' + Math.random(),
          label: 'New ' + i
        }))
      )
      Dumbact.set('bench:items', items)
      Dumbact.flush()
      items = items.slice(0, N)
      Dumbact.set('bench:items', items)
      Dumbact.flush()
    }, 7)
    return {
      environment: navigator.userAgent,
      N,
      directInitial: {
        median: ms(directInitial.median),
        min: ms(directInitial.min),
        max: ms(directInitial.max)
      },
      dumbactInitial: {
        median: ms(dumbactInitial.median),
        min: ms(dumbactInitial.min),
        max: ms(dumbactInitial.max)
      },
      singleTextUpdate: {
        median: ms(singleTextUpdate.median),
        min: ms(singleTextUpdate.min),
        max: ms(singleTextUpdate.max)
      },
      keyedReverse: {
        median: ms(keyedReverse.median),
        min: ms(keyedReverse.min),
        max: ms(keyedReverse.max)
      },
      append100: {
        median: ms(append100.median),
        min: ms(append100.min),
        max: ms(append100.max)
      }
    }
  })
  assert.deepEqual(errors, [], errors.join('\n'))
  assert.ok(result.dumbactInitial.median < 1000, 'initial render too slow: ' + result.dumbactInitial.median + 'ms')
  assert.ok(result.singleTextUpdate.median < 1000, 'update too slow: ' + result.singleTextUpdate.median + 'ms')
  assert.ok(result.keyedReverse.median < 1000, 'reverse too slow: ' + result.keyedReverse.median + 'ms')
  const lines = [
    '# Benchmark results',
    '',
    'These numbers are produced by `npm run test:bench` in Chromium on this machine. They are not universal performance claims. They are a reproducible smoke benchmark that catches obvious regressions.',
    '',
    '| case | median / min / max |',
    '|---|---|',
    row('rows', String(result.N)),
    row(
      'direct DOM initial render',
      `${result.directInitial.median} / ${result.directInitial.min} / ${result.directInitial.max} ms`
    ),
    row(
      'Dumbact initial render',
      `${result.dumbactInitial.median} / ${result.dumbactInitial.min} / ${result.dumbactInitial.max} ms`
    ),
    row(
      'Dumbact single text update',
      `${result.singleTextUpdate.median} / ${result.singleTextUpdate.min} / ${result.singleTextUpdate.max} ms`
    ),
    row(
      'Dumbact keyed reverse',
      `${result.keyedReverse.median} / ${result.keyedReverse.min} / ${result.keyedReverse.max} ms`
    ),
    row('Dumbact append 100', `${result.append100.median} / ${result.append100.min} / ${result.append100.max} ms`),
    '',
    'Browser:',
    '',
    '```',
    result.environment,
    '```',
    ''
  ]
  writeFileSync(join(root, 'BENCHMARK.md'), lines.join('\n'))
  message = `benchmark passed rows=${result.N} dumbactInitial=${result.dumbactInitial.median}ms update=${result.singleTextUpdate.median}ms reverse=${result.keyedReverse.median}ms`
} finally {
  if (page && !page.isClosed()) await closeSoon(page.close())
  await closeSoon(browser.close())
  await cleanupChromium()
}
if (message) {
  console.log(message)
  process.exit(0)
}
