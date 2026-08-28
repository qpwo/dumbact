import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, readFileSync, readdirSync, readlinkSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const root = dirname(fileURLToPath(import.meta.url))
const demos = root
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
  'demo-counter/index.html',
  'demo-todo/index.html',
  'demo-drilling/index.html',
  'demo-list/index.html',
  'demo-form/index.html',
  'demo-svg/index.html',
  'demo-notes/index.html',
  'demo-sse/index.html',
  'demo-module/index.html',
  'demo-cdn/index.html',
  'demo-cdn-module/index.html'
]
const serverNames = [
  'demo-notes/server.mjs',
  'demo-sse/server.mjs',
  'demo-vote/server.mjs',
  'demo-palette/server.mjs'
]
const folderHtmlNames = ['demo-grocery/index.html', 'demo-queue/index.html']
const folderServerNames = ['demo-grocery/server.mjs', 'demo-queue/server.mjs']
const viewports = [
  { suffix: 'desktop', opts: { viewport: { width: 1200, height: 850 } } },
  { suffix: 'mobile', opts: { viewport: { width: 390, height: 760 } } }
]
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
    readFileSync(join(demos, name), 'utf8').replace('<head>', `<head><base href="http://dumbact.local/${name}">`)
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
  if (click && id === "demo-module") {
    await p.getByLabel('module increase').click()
    await p.waitForFunction(() => document.querySelector('[data-testid="module-count"]')?.textContent === '1')
  }
  if (click && id === "demo-cdn-module") {
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

for (const name of htmlNames) assert.ok(existsSync(join(root, name)), name + ' exists')
for (const name of serverNames) assert.ok(existsSync(join(root, name)), name + ' exists')
for (const name of folderHtmlNames.concat(folderServerNames)) assert.ok(existsSync(join(demos, name)), name + ' exists')
for (const lock of ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb'])
  assert.ok(!walk(root).some(f => f.endsWith(lock)), lock + ' exists')
sh([process.execPath, '--check', join(root, 'dumbact.js')])
for (const s of serverNames.concat(folderServerNames)) sh([process.execPath, '--check', join(demos, s)])
sh([process.execPath, join(root, 'test-runtime.js')])
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
  vote: await start(serverNames[2]),
  palette: await start(serverNames[3]),
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
    { id: 'demo-minimal', html: rootHtml('demo-minimal/index.html') },
    { id: 'demo-counter', html: diskHtml(htmlNames[0]) },
    { id: 'demo-todo', html: diskHtml(htmlNames[1]) },
    { id: 'demo-drilling', html: diskHtml(htmlNames[2]) },
    { id: 'demo-list', html: diskHtml(htmlNames[3]) },
    { id: 'demo-form', html: diskHtml(htmlNames[4]) },
    { id: 'demo-svg', html: diskHtml(htmlNames[5]) },
    { id: 'demo-notes', html: diskHtml(htmlNames[6], servers.notes.url) },
    { id: 'demo-sse', html: diskHtml(htmlNames[7], servers.sse.url) },
    { id: 'demo-cdn', html: diskHtml(htmlNames[9]) }
  ]
  const actions = {
    'demo-minimal': async p => {
      await p.getByLabel('increase').click()
      await p.waitForFunction(() => document.querySelector('[data-testid="minimal-count"]')?.textContent.includes('1'))
    },
    'demo-counter': async p => {
      await p.getByLabel('increase').click()
      await p.waitForFunction(() => document.querySelector('[data-testid="count"]')?.textContent === '1')
      await p.selectOption('select[aria-label="step"]', '5')
      await p.getByLabel('increase').click()
      await p.waitForFunction(() => document.querySelector('[data-testid="count"]')?.textContent === '6')
    },
    'demo-todo': async p => {
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
    'demo-drilling': async p => {
      await p.fill('[data-testid="name-input"]', 'Ada')
      await p.waitForFunction(() => document.querySelector('[data-testid="deep-name"]')?.textContent.includes('Ada'))
      await p.locator('button', { hasText: '+' }).first().click()
      await p.waitForFunction(() => document.querySelector('[data-testid="cart-count"]')?.textContent === '4')
    },
    'demo-list': async p => {
      const first = await p.locator('[data-row-id]').first().getAttribute('data-row-id')
      await p.getByRole('button', { name: 'Reverse' }).click()
      await p.waitForTimeout(80)
      assert.notEqual(await p.locator('[data-row-id]').first().getAttribute('data-row-id'), first)
      await p.getByRole('button', { name: 'Append 80' }).click()
      await p.waitForFunction(() => document.querySelectorAll('[data-row-id]').length >= 240)
    },
    'demo-form': async p => {
      await p.fill('#name', 'Ada')
      await p.fill('#email', 'ada@example.com')
      await p.fill('#message', 'This is long enough.')
      await p.waitForFunction(() => !document.querySelector('[data-testid="send"]')?.disabled)
      await p.evaluate(() => document.querySelector('[data-testid="send"]').click())
      await p.waitForSelector('[data-testid="sent"]')
    },
    'demo-svg': async p => {
      const total = await p.locator('[data-testid="total"]').innerText()
      await p.locator('[data-testid="range-a"]').fill('90')
      await p.waitForFunction(old => document.querySelector('[data-testid="total"]')?.textContent !== old, total)
    },
    'demo-notes': async p => {
      await p.fill('[data-testid="note-input"]', 'server note from smoke test')
      await p.click('[data-testid="note-add"]')
      await p.waitForSelector('[data-testid="notes"] >> text=server note from smoke test')
    },
    'demo-sse': async p => {
      await p.waitForFunction(
        () => Number(document.querySelector('[data-testid="sse-count"]')?.textContent || 0) >= 2,
        null,
        { timeout: 5000 }
      )
    },
    'demo-cdn': async p => {
      await p.getByRole('button', { name: 'data' }).click()
      await p.waitForFunction(() => document.querySelector('[data-testid="cdn-total"]')?.textContent === '10')
      await p.waitForFunction(() =>
        /lodash|shim/.test(document.querySelector('[data-testid="cdn-lib"]')?.textContent || '')
      )
    },
    'demo-vote': async p => {
      const beforeVote = await p.locator('[data-testid="vote-total"]').innerText()
      await p.locator('[data-testid="vote-ids"]').click()
      await p.waitForFunction(
        old => document.querySelector('[data-testid="vote-total"]')?.textContent !== old,
        beforeVote
      )
    },
    'demo-palette': async p => {
      await p.fill('[data-testid="palette-input"]', 'goblin')
      await p.waitForSelector('[data-testid="palette-results"] >> text=Pin goblin dashboard')
    }
  }
  for (const v of viewports) {
    await moduleReady(
      browser,
      'demo-module/index.html',
      'demo-module',
      v.opts,
      { colorScheme: 'light' },
      true
    )
  }
  for (const v of viewports) {
    await moduleReady(
      browser,
      'demo-cdn-module/index.html',
      'demo-cdn-module',
      v.opts,
      { colorScheme: 'light' },
      true
    )
  }
  for (const v of viewports) {
    await serverExercise(
      browser,
      servers.vote,
      'demo-vote',
      v.opts,
      { colorScheme: 'dark' },
      actions['demo-vote']
    )
  }
  for (const v of viewports) {
    await serverExercise(
      browser,
      servers.palette,
      'demo-palette',
      v.opts,
      { colorScheme: 'dark' },
      actions['demo-palette']
    )
  }
  for (const v of viewports) {
    await serverExercise(
      browser,
      servers.grocery,
      'demo-grocery',
      v.opts,
      { colorScheme: 'light' },
      async p => {
        await p.waitForFunction(() => document.querySelector('[data-testid="grocery-status"]')?.textContent === 'ready')
        await p.fill('[data-testid="grocery-input"]', 'Bananas')
        await p.click('[data-testid="grocery-add"]')
        await p.waitForSelector('[data-testid="grocery-list"] >> text=Bananas')
      }
    )
  }
  for (const v of viewports) {
    await serverExercise(
      browser,
      servers.queue,
      'demo-queue',
      v.opts,
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
  }
  for (const v of viewports) {
    for (const c of cases) {
      console.log('ready', c.id, v.suffix)
      await exercise(browser, c, v.opts, actions[c.id])
    }
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
