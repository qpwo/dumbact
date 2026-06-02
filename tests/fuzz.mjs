import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, readlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright-core'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
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

const { browser, page } = await launchPage({ width: 900, height: 700 })
let message = ''
try {
  const errors = []
  page.on('pageerror', e => errors.push(e.stack || e.message))
  page.on('console', m => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await page.setContent(`<!doctype html><meta charset="utf-8"><main id="app"></main><script>${runtime}</script>`)
  const result = await page.evaluate(async () => {
    const seed0 = 0x5eed1234
    let seed = seed0 >>> 0
    function rand() {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 0x100000000
    }
    function id(n) {
      return 'k' + n
    }
    let nextId = 40
    let items = Array.from({ length: 40 }, (_, i) => ({
      id: id(i),
      text: 'item ' + i
    }))
    const root = document.getElementById('app')
    function App() {
      const list = Dumbact.get('fuzz:items', [])
      return Dumbact.h(
        'ul',
        { id: 'list' },
        list.map(item =>
          Dumbact.h(
            'li',
            {
              key: item.id,
              'data-id': item.id,
              onClick: () => Dumbact.set('fuzz:last-click', item.id)
            },
            item.text
          )
        )
      )
    }
    function nodes() {
      return Array.from(document.querySelectorAll('#list > li'))
    }
    function domIds() {
      return nodes().map(n => n.getAttribute('data-id'))
    }
    function assertDom(step) {
      const got = domIds().join('|')
      const want = items.map(x => x.id).join('|')
      if (got !== want) throw new Error('order mismatch at step ' + step + '\nwant ' + want + '\ngot  ' + got)
      const text = nodes()
        .map(n => n.textContent)
        .join('|')
      const textWant = items.map(x => x.text).join('|')
      if (text !== textWant) throw new Error('text mismatch at step ' + step)
    }
    Dumbact.set('fuzz:items', items)
    Dumbact.render(App, root)
    Dumbact.flush()
    assertDom(0)
    let map = new Map(nodes().map(n => [n.getAttribute('data-id'), n]))
    let operations = 0
    for (let step = 1; step <= 320; step++) {
      const previous = map
      const op = Math.floor(rand() * 8)
      if (op === 0 && items.length) {
        const i = Math.floor(rand() * items.length)
        items = items.filter((_, index) => index !== i)
      } else if (op === 1) {
        const item = { id: id(nextId++), text: 'item ' + nextId }
        const i = Math.floor(rand() * (items.length + 1))
        items = items.slice(0, i).concat(item, items.slice(i))
      } else if (op === 2 && items.length) {
        const i = Math.floor(rand() * items.length)
        items = items.map((x, index) => (index === i ? { id: x.id, text: x.text + '!' } : x))
      } else if (op === 3) {
        items = items.slice().reverse()
      } else if (op === 4 && items.length > 1) {
        const a = Math.floor(rand() * items.length)
        const b = Math.floor(rand() * items.length)
        items = items.slice()
        const t = items[a]
        items[a] = items[b]
        items[b] = t
      } else if (op === 5) {
        items = items.slice().sort((a, b) => a.id.localeCompare(b.id))
      } else if (op === 6) {
        items = items.slice(0, Math.min(items.length, 80))
      } else {
        while (items.length < 50) items.push({ id: id(nextId++), text: 'item ' + nextId })
      }
      Dumbact.set('fuzz:items', items)
      await Promise.resolve()
      Dumbact.flush()
      assertDom(step)
      map = new Map(nodes().map(n => [n.getAttribute('data-id'), n]))
      for (const item of items) {
        if (previous.has(item.id) && previous.get(item.id) !== map.get(item.id)) {
          throw new Error('keyed node was replaced for ' + item.id + ' at step ' + step)
        }
      }
      operations++
    }
    if (items.length) {
      nodes()[0].click()
      await Promise.resolve()
      Dumbact.flush()
      if (Dumbact.peek('fuzz:last-click') !== items[0].id) throw new Error('latest keyed click handler failed')
    }

    Dumbact.clear('event:')
    let sum = 0
    function Button() {
      const value = Dumbact.get('event:value', 1)
      return Dumbact.h(
        'button',
        {
          id: 'event-button',
          onClick: () => {
            sum += value
          }
        },
        String(value)
      )
    }
    const eventRoot = document.createElement('section')
    document.body.appendChild(eventRoot)
    Dumbact.render(Button, eventRoot)
    for (let i = 1; i <= 60; i++) {
      Dumbact.set('event:value', i)
      await Promise.resolve()
      Dumbact.flush()
      document.getElementById('event-button').click()
    }
    const wantSum = (60 * 61) / 2
    if (sum !== wantSum) throw new Error('event replacement sum ' + sum + ' expected ' + wantSum)

    let renders = 0
    const tmp = document.createElement('aside')
    document.body.appendChild(tmp)
    function Temp() {
      renders++
      return Dumbact.h('span', null, Dumbact.get('dead:value', 0))
    }
    Dumbact.render(Temp, tmp)
    Dumbact.unmount(tmp)
    Dumbact.set('dead:value', 1)
    await Promise.resolve()
    Dumbact.flush()
    if (renders !== 1 || tmp.childNodes.length !== 0) throw new Error('unmount left live view behind')

    return {
      seed: '0x' + seed0.toString(16),
      operations,
      finalLength: items.length,
      eventSum: sum
    }
  })
  assert.deepEqual(errors, [], errors.join('\n'))
  message = `browser fuzz passed seed=${result.seed} operations=${result.operations} finalLength=${result.finalLength} eventSum=${result.eventSum}`
} finally {
  if (page && !page.isClosed()) await closeSoon(page.close())
  await closeSoon(browser.close())
  await cleanupChromium()
}
if (message) {
  console.log(message)
  process.exit(0)
}
