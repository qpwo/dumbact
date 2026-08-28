import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, readFileSync, readdirSync, readlinkSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const demos = join(root, 'demos')
const runtime = readFileSync(join(root, 'dumbact.js'), 'utf8')

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
const chromiumPath = findChromium()
const chromiumArgs = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-software-rasterizer',
  '--disable-crash-reporter',
  '--disable-breakpad'
]
const htmlNames = [
  '01-state-ids-counter-tsx.html',
  '02-local-todo-jsx.html',
  '03-no-prop-drilling-ts.html',
  '04-keyed-list-benchmark-js.html',
  '05-form-validation-tsx.html',
  '06-svg-dashboard-jsx.html',
  '07-api-notes-paired.html',
  '08-sse-metrics-paired.html',
  '11-module-graph-tsx.html',
  '12-cdn-html-libs.html',
  '13-cdn-module-tsx.html'
]
const serverNames = [
  '07-api-notes-paired.server.mjs',
  '08-sse-metrics-paired.server.mjs',
  '09-vote-wall-singlefile.server.mjs',
  '10-command-palette-singlefile.server.mjs'
]
const folderHtmlNames = ['14-multifile-jsx/index.html', '15-multifile-tsx/index.html']
const folderServerNames = ['14-multifile-jsx/server.mjs', '15-multifile-tsx/server.mjs']
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}
function sh(args) {
  const r = spawnSync(args[0], args.slice(1), { cwd: root, encoding: 'utf8' })
  assert.equal(r.status, 0, `${args.join(' ')}\n${r.stderr || r.stdout}`)
}
function freePort() {
  return new Promise((ok, fail) => {
    const s = createServer()
    s.on('error', fail)
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port
      s.close(() => ok(p))
    })
  })
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
async function closeSoon(task, ms = 4000) {
  try {
    await Promise.race([task, delay(ms)])
  } catch (_) {}
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

async function waitUrl(url, ms = 7000) {
  const end = Date.now() + ms
  let last
  while (Date.now() < end) {
    try {
      const r = await fetch(url)
      if (r.ok) return
      last = new Error('HTTP ' + r.status)
    } catch (e) {
      last = e
    }
    await new Promise(r => setTimeout(r, 100))
  }
  throw last || new Error('timeout ' + url)
}
async function start(rel) {
  const port = await freePort()
  const child = spawn(process.execPath, [join(demos, rel)], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let log = ''
  child.stdout.on('data', b => {
    log += b.toString()
  })
  child.stderr.on('data', b => {
    log += b.toString()
  })
  await waitUrl(`http://127.0.0.1:${port}/api/health`).catch(e => {
    child.kill('SIGTERM')
    throw new Error(`${rel}: ${e.message}\n${log}`)
  })
  return {
    url: `http://127.0.0.1:${port}/`,
    stop: () =>
      new Promise(done => {
        let settled = false
        const finish = () => {
          if (!settled) {
            settled = true
            done()
          }
        }
        if (child.exitCode !== null || child.signalCode !== null) return finish()
        child.once('exit', finish)
        child.kill('SIGTERM')
        setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
          finish()
        }, 1000).unref()
      })
  }
}
function inlineRuntime(html) {
  return html.replace(/<script src="\.\.\/dumbact\.js"><\/script>/, runtimeScript)
}

function runtimeScript() {
  return `<script>${runtime.replaceAll('</script>', '<\\/script>')}</script>`
}
function absolutize(html, origin) {
  return html
    .replaceAll('"/api/', `"${origin}api/`)
    .replaceAll("'/api/", `'${origin}api/`)
    .replaceAll('"/events"', `"${origin}events"`)
    .replaceAll("'/events'", `'${origin}events'`)
}
function diskHtml(name, origin = '') {
  let html = inlineRuntime(readFileSync(join(demos, name), 'utf8'))
  if (origin) html = absolutize(html, origin)
  return html
}
function rootHtml(name) {
  return inlineRuntime(
    readFileSync(join(root, name), 'utf8').replace(/<script src="\.\/dumbact\.js"><\/script>/, runtimeScript)
  )
}
function moduleHtml(name) {
  return inlineRuntime(
    readFileSync(join(demos, name), 'utf8').replace('<head>', `<head><base href="http://dumbact.local/demos/${name}">`)
  )
}
async function routeModuleFiles(p) {
  await p.route('http://dumbact.local/**', route => {
    const url = new URL(route.request().url())
    const full = join(root, url.pathname.replace(/^\//, ''))
    if (!existsSync(full)) return route.fulfill({ status: 404, body: 'missing' })
    return route.fulfill({
      status: 200,
      body: readFileSync(full),
      headers: {
        'content-type': /\.(ts|tsx|jsx)$/.test(full) ? 'text/plain' : 'application/javascript'
      }
    })
  })
}
async function routeCdn(p) {
  await p.route('https://cdn.jsdelivr.net/**', route => {
    const url = route.request().url()
    if (/bootstrap@5\.3\.3\/dist\/css\/bootstrap\.min\.css/.test(url))
      return route.fulfill({
        status: 200,
        body: '.btn{display:inline-block}.btn-primary{}.btn-outline-secondary{}.container{}.row{}',
        headers: { 'content-type': 'text/css' }
      })
    if (/lodash@4\.17\.21\/lodash\.min\.js/.test(url))
      return route.fulfill({
        status: 200,
        body: `window._={__name:'lodash-cdn-shim',VERSION:'4.17.21',countBy(xs,fn){const out={};for(const x of xs){const k=String(fn(x));out[k]=(out[k]||0)+1}return out},sortBy(xs,fn){return xs.slice().sort((a,b)=>String(fn(a)).localeCompare(String(fn(b))))},sumBy(xs,fn){return xs.reduce((n,x)=>n+Number(fn(x)||0),0)}};`,
        headers: { 'content-type': 'application/javascript' }
      })
    if (/lodash-es@4\.17\.21\/chunk\.js/.test(url))
      return route.fulfill({
        status: 200,
        body: `export default function chunk(xs,n){n=Math.max(1,Number(n)||1);const out=[];for(let i=0;i<xs.length;i+=n)out.push(xs.slice(i,i+n));return out}`,
        headers: { 'content-type': 'application/javascript' }
      })
    return route.fulfill({ status: 404, body: 'missing cdn shim' })
  })
}
async function serverHtml(server) {
  return absolutize(await (await fetch(server.url)).text(), server.url)
}
async function newPage(browser, opts, media) {
  const p = await browser.newPage(opts)
  p.setDefaultTimeout(9000)
  p.setDefaultNavigationTimeout(9000)
  await routeCdn(p)
  const errors = []
  p.on('pageerror', e => errors.push(e.stack || e.message))
  p.on('console', m => {
    if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text())
  })
  p.clean = () => assert.deepEqual(errors, [], errors.join('\n'))
  if (media) await p.emulateMedia(media)
  return p
}
async function loadReady(p, html, id) {
  await p
    .evaluate(() => {
      try {
        window.dispatchEvent(new Event('beforeunload'))
      } catch (_) {}
    })
    .catch(() => {})
  await p.setContent(html, { waitUntil: 'domcontentloaded', timeout: 10000 })
  await p.waitForFunction(x => document.documentElement.dataset.demoReady === x, id, { timeout: 8000 })
  await p.waitForSelector('[data-ready]')
  assert.ok((await p.locator('h1').innerText()).trim().length > 3)
  const overflow = await p.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth)
  assert.ok(overflow <= 4, `horizontal overflow ${overflow} in ${id}`)
  const sysErrors = await p.evaluate(() =>
    (window.Dumbact?.peek?.('sys:errors', []) || []).map(e => String((e && e.message) || e))
  )
  assert.deepEqual(sysErrors, [])
  p.clean()
}
async function readiness(browser, cases, opts, media) {
  for (const c of cases) {
    console.log('ready', c.id)
    const p = await newPage(browser, opts, media)
    try {
      await loadReady(p, c.html, c.id)
    } finally {
      await p.close()
    }
  }
}
async function moduleReady(browser, name, id, opts, media, click) {
  console.log('ready ' + id + '-module')
  const p = await newPage(browser, opts, media)
  await routeModuleFiles(p)
  await loadReady(p, moduleHtml(name), id)
  if (click && id === '11') {
    await p.getByLabel('module increase').click()
    await p.waitForFunction(() => document.querySelector('[data-testid="module-count"]')?.textContent === '1')
  }
  if (click && id === '13') {
    await p.getByLabel('larger chunks').click()
    await p.waitForFunction(() => document.querySelector('[data-testid="cdnmod-size"]')?.textContent === '4')
  }
  p.clean()
  await p.close()
}
async function exercise(browser, c, opts, fn) {
  const p = await newPage(browser, opts)
  try {
    await loadReady(p, c.html, c.id)
    if (fn) await fn(p)
    p.clean()
  } finally {
    await p.close()
  }
}
async function gotoReady(p, url, id) {
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 })
  await p.waitForFunction(x => document.documentElement.dataset.demoReady === x, id, { timeout: 8000 })
  await p.waitForSelector('[data-ready]')
  assert.ok((await p.locator('h1').innerText()).trim().length > 3)
  const overflow = await p.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth)
  assert.ok(overflow <= 4, `horizontal overflow ${overflow} in ${id}`)
  const sysErrors = await p.evaluate(() =>
    (window.Dumbact?.peek?.('sys:errors', []) || []).map(e => String((e && e.message) || e))
  )
  assert.deepEqual(sysErrors, [])
  p.clean()
}
async function serverExercise(browser, server, id, opts, media, fn) {
  console.log('ready ' + id + '-server-module')
  const p = await newPage(browser, opts, media)
  try {
    await gotoReady(p, server.url, id)
    if (fn) await fn(p)
    p.clean()
  } finally {
    await p.close()
  }
}

assert.deepEqual(
  readdirSync(demos)
    .filter(n => n.endsWith('.html'))
    .sort(),
  htmlNames
)
assert.deepEqual(
  readdirSync(demos)
    .filter(n => n.endsWith('.server.mjs'))
    .sort(),
  serverNames
)
for (const name of folderHtmlNames.concat(folderServerNames)) assert.ok(existsSync(join(demos, name)), name + ' exists')
for (const lock of ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb'])
  assert.ok(!walk(root).some(f => f.endsWith(lock)), lock + ' exists')
sh([process.execPath, '--check', join(root, 'dumbact.js')])
for (const s of serverNames.concat(folderServerNames)) sh([process.execPath, '--check', join(demos, s)])
sh([process.execPath, join(root, 'dumbact.test.js')])
const D = await import(join(root, 'dumbact.js'))
for (const [mode, source] of [
  ['js', 'const x=1'],
  ['ts', 'type X = {a:string};\nconst f=(x: number)=>x+1;'],
  ['jsx', 'const x=<div class="a">hi {1}</div>;'],
  ['tsx', 'type P = {x:number};\nconst x=<span>{2}</span>;']
])
  new Function('Dumbact', D.default?.compile?.(source, mode) || D.compile(source, mode))(D.default || D)
assert.ok(existsSync(chromiumPath), 'missing Chromium at ' + chromiumPath)

const servers = {
  notes: await start(serverNames[0]),
  sse: await start(serverNames[1]),
  grocery: await start(folderServerNames[0]),
  queue: await start(folderServerNames[1])
}
let browser
let passed = false
try {
  browser = await chromium.launch({
    executablePath: chromiumPath,
    args: chromiumArgs
  })
  const cases = [
    { id: 'minimal', html: rootHtml('minimal-counter.html') },
    { id: '01', html: diskHtml(htmlNames[0]) },
    { id: '02', html: diskHtml(htmlNames[1]) },
    { id: '03', html: diskHtml(htmlNames[2]) },
    { id: '04', html: diskHtml(htmlNames[3]) },
    { id: '05', html: diskHtml(htmlNames[4]) },
    { id: '06', html: diskHtml(htmlNames[5]) },
    { id: '07', html: diskHtml(htmlNames[6], servers.notes.url) },
    { id: '08', html: diskHtml(htmlNames[7], servers.sse.url) },
    { id: '12', html: diskHtml(htmlNames[9]) }
  ]
  const actions = {
    minimal: async p => {
      await p.getByLabel('increase').click()
      await p.waitForFunction(() => document.querySelector('[data-testid="minimal-count"]')?.textContent.includes('1'))
    },
    '01': async p => {
      await p.getByLabel('increase').click()
      await p.waitForFunction(() => document.querySelector('[data-testid="count"]')?.textContent === '1')
      await p.selectOption('select[aria-label="step"]', '5')
      await p.getByLabel('increase').click()
      await p.waitForFunction(() => document.querySelector('[data-testid="count"]')?.textContent === '6')
    },
    '02': async p => {
      await p.evaluate(() => {
        try {
          localStorage.removeItem('dumbact:todos')
        } catch (_) {}
        const S = Dumbact.scope('todos')
        S.set('items', [])
        S.set('text', '')
        S.set('filter', 'all')
      })
      await p.fill('[data-testid="todo-input"]', 'Test the gremlin trap')
      await p.click('[data-testid="todo-add"]')
      await p.waitForSelector('[data-testid="todo-list"] >> text=Test the gremlin trap')
    },
    '03': async p => {
      await p.fill('[data-testid="name-input"]', 'Ada')
      await p.waitForFunction(() => document.querySelector('[data-testid="deep-name"]')?.textContent.includes('Ada'))
      await p.locator('button', { hasText: '+' }).first().click()
      await p.waitForFunction(() => document.querySelector('[data-testid="cart-count"]')?.textContent === '4')
    },
    '04': async p => {
      const first = await p.locator('[data-row-id]').first().getAttribute('data-row-id')
      await p.getByRole('button', { name: 'Reverse' }).click()
      await p.waitForTimeout(80)
      assert.notEqual(await p.locator('[data-row-id]').first().getAttribute('data-row-id'), first)
      await p.getByRole('button', { name: 'Append 80' }).click()
      await p.waitForFunction(() => document.querySelectorAll('[data-row-id]').length >= 240)
    },
    '05': async p => {
      await p.fill('#name', 'Ada')
      await p.fill('#email', 'ada@example.com')
      await p.fill('#message', 'This is long enough.')
      await p.waitForFunction(() => !document.querySelector('[data-testid="send"]')?.disabled)
      await p.evaluate(() => document.querySelector('[data-testid="send"]').click())
      await p.waitForSelector('[data-testid="sent"]')
    },
    '06': async p => {
      const total = await p.locator('[data-testid="total"]').innerText()
      await p.locator('[data-testid="range-a"]').fill('90')
      await p.waitForFunction(old => document.querySelector('[data-testid="total"]')?.textContent !== old, total)
    },
    '07': async p => {
      await p.fill('[data-testid="note-input"]', 'server note from smoke test')
      await p.click('[data-testid="note-add"]')
      await p.waitForSelector('[data-testid="notes"] >> text=server note from smoke test')
    },
    '08': async p => {
      await p.waitForFunction(
        () => Number(document.querySelector('[data-testid="sse-count"]')?.textContent || 0) >= 2,
        null,
        { timeout: 5000 }
      )
    },
    12: async p => {
      await p.getByRole('button', { name: 'data' }).click()
      await p.waitForFunction(() => document.querySelector('[data-testid="cdn-total"]')?.textContent === '10')
      await p.waitForFunction(() =>
        /lodash|shim/.test(document.querySelector('[data-testid="cdn-lib"]')?.textContent || '')
      )
    },
    '09': async p => {
      const beforeVote = await p.locator('[data-testid="vote-total"]').innerText()
      await p.locator('[data-testid="vote-ids"]').click()
      await p.waitForFunction(
        old => document.querySelector('[data-testid="vote-total"]')?.textContent !== old,
        beforeVote
      )
    },
    10: async p => {
      await p.fill('[data-testid="palette-input"]', 'goblin')
      await p.waitForSelector('[data-testid="palette-results"] >> text=Pin goblin dashboard')
    }
  }
  await moduleReady(
    browser,
    '11-module-graph-tsx.html',
    '11',
    { viewport: { width: 1200, height: 850 } },
    { colorScheme: 'light' },
    true
  )
  await moduleReady(
    browser,
    '13-cdn-module-tsx.html',
    '13',
    { viewport: { width: 1200, height: 850 } },
    { colorScheme: 'light' },
    true
  )
  await serverExercise(
    browser,
    servers.grocery,
    '14',
    { viewport: { width: 390, height: 780 } },
    { colorScheme: 'light' },
    async p => {
      await p.waitForFunction(() => document.querySelector('[data-testid="grocery-status"]')?.textContent === 'ready')
      await p.fill('[data-testid="grocery-input"]', 'Bananas')
      await p.click('[data-testid="grocery-add"]')
      await p.waitForSelector('[data-testid="grocery-list"] >> text=Bananas')
    }
  )
  await serverExercise(
    browser,
    servers.queue,
    '15',
    { viewport: { width: 1200, height: 850 } },
    { colorScheme: 'dark' },
    async p => {
      await p.waitForFunction(() => document.querySelector('[data-testid="queue-status"]')?.textContent === 'ready')
      await p.fill('[data-testid="queue-input"]', 'True wheel')
      await p.click('[data-testid="queue-add"]')
      await p.waitForSelector('[data-testid="queue-list"] >> text=True wheel')
      await p.click('[data-testid="queue-advance-chain"]')
      await p.waitForFunction(() => document.querySelector('[data-testid="queue-done"]')?.textContent === '2')
    }
  )
  for (const c of cases) {
    console.log('ready', c.id)
    await exercise(
      browser,
      c,
      {
        viewport: {
          width: c.id === '02' || c.id === '05' || c.id === '08' || c.id === '10' ? 390 : 1200,
          height: c.id === '02' || c.id === '05' || c.id === '08' || c.id === '10' ? 760 : 850
        }
      },
      actions[c.id]
    )
  }
  passed = true
} finally {
  if (browser) await closeSoon(browser.close())
  await Promise.all(Object.values(servers).map(s => s.stop()))
  await cleanupChromium()
}
if (passed) {
  console.log('demo smoke tests passed')
  process.exit(0)
}
