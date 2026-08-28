#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const root = dirname(fileURLToPath(import.meta.url))
const demos = root
const Dumbact = require(join(root, 'dumbact.js'))

const htmlNames = [
  'demo-counter.html',
  'demo-todo.html',
  'demo-drilling.html',
  'demo-list.html',
  'demo-form.html',
  'demo-svg.html',
  'demo-cdn.html'
]
const serverNames = [
  'demo-notes.mjs',
  'demo-sse.mjs',
  'demo-vote.mjs',
  'demo-palette.mjs'
]
const folderHtmlNames = [
  'demo-module/index.html',
  'demo-cdn-module/index.html',
  'demo-grocery/index.html',
  'demo-queue/index.html'
]
const folderServerNames = ['demo-grocery/server.mjs', 'demo-queue/server.mjs']
const allHtmlNames = htmlNames.concat(folderHtmlNames)
const moduleSources = {
  'demo-module/index.html': [
    ['demo-module/state.ts', 'ts'],
    ['demo-module/view.tsx', 'tsx'],
    ['demo-module/main.tsx', 'tsx']
  ],
  'demo-cdn-module/index.html': [
    ['demo-cdn-module/data.ts', 'ts'],
    ['demo-cdn-module/view.tsx', 'tsx'],
    ['demo-cdn-module/main.tsx', 'tsx']
  ],
  'demo-grocery/index.html': [
    ['demo-grocery/api.js', 'js'],
    ['demo-grocery/state.js', 'js'],
    ['demo-grocery/view.jsx', 'jsx'],
    ['demo-grocery/app.jsx', 'jsx']
  ],
  'demo-queue/index.html': [
    ['demo-queue/data.ts', 'ts'],
    ['demo-queue/api.ts', 'ts'],
    ['demo-queue/state.ts', 'ts'],
    ['demo-queue/view.tsx', 'tsx'],
    ['demo-queue/app.tsx', 'tsx']
  ]
}
const removedRuntimeAPIs =
  /Dumbact\.(?:derive|ask|resource|watch|restore|cloneElement|toChildArray|isValidElement|batch|update|replaceAllState|unsafeHTML)\b/

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
      const port = s.address().port
      s.close(() => ok(port))
    })
  })
}
async function waitUrl(url, ms = 7000) {
  const end = Date.now() + ms
  let last
  while (Date.now() < end) {
    try {
      const r = await fetch(url)
      if (r.ok) return
      last = new Error('HTTP ' + r.status)
    } catch (error) {
      last = error
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
  await waitUrl(`http://127.0.0.1:${port}/api/health`).catch(error => {
    child.kill('SIGTERM')
    throw new Error(`${rel}: ${error.message}\n${log}`)
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
async function withServer(rel, fn) {
  const server = await start(rel)
  try {
    return await fn(server)
  } finally {
    await server.stop()
  }
}
function scripts(html) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map(m => ({ attrs: m[1], text: m[2] }))
}
function attr(attrs, name) {
  const re = new RegExp('\\b' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i')
  const m = re.exec(attrs)
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : ''
}

class FakeNode {
  constructor(doc) {
    this.ownerDocument = doc || null
    this.parentNode = null
    this.childNodes = []
  }
  get firstChild() {
    return this.childNodes[0] || null
  }
  get nextSibling() {
    if (!this.parentNode) return null
    const a = this.parentNode.childNodes
    const i = a.indexOf(this)
    return i >= 0 ? a[i + 1] || null : null
  }
  appendChild(node) {
    return this.insertBefore(node, null)
  }
  insertBefore(node, before) {
    if (before && before.parentNode !== this) throw new Error('insertBefore reference is not a child')
    if (node.parentNode) node.parentNode.removeChild(node)
    const i = before ? this.childNodes.indexOf(before) : -1
    if (i < 0) this.childNodes.push(node)
    else this.childNodes.splice(i, 0, node)
    node.parentNode = this
    if (!node.ownerDocument) node.ownerDocument = this.ownerDocument
    return node
  }
  removeChild(node) {
    const i = this.childNodes.indexOf(node)
    if (i < 0) throw new Error('removeChild target is not a child')
    this.childNodes.splice(i, 1)
    node.parentNode = null
    return node
  }
  get textContent() {
    return this.childNodes.map(n => n.textContent).join('')
  }
  set textContent(value) {
    while (this.firstChild) this.removeChild(this.firstChild)
    if (value !== '') this.appendChild(this.ownerDocument.createTextNode(String(value)))
  }
}
class FakeText extends FakeNode {
  constructor(doc, value) {
    super(doc)
    this.nodeType = 3
    this.nodeName = '#text'
    this.nodeValue = String(value)
  }
  get textContent() {
    return this.nodeValue
  }
  set textContent(value) {
    this.nodeValue = String(value)
  }
}
class FakeComment extends FakeNode {
  constructor(doc, value) {
    super(doc)
    this.nodeType = 8
    this.nodeName = '#comment'
    this.nodeValue = String(value)
  }
  get textContent() {
    return ''
  }
  set textContent(_) {}
}
class FakeElement extends FakeNode {
  constructor(doc, tag) {
    super(doc)
    this.nodeType = 1
    this.localName = String(tag).toLowerCase()
    this.tagName = String(tag).toUpperCase()
    this.nodeName = this.tagName
    this.attributes = Object.create(null)
    this.style = Object.create(null)
    this.dataset = Object.create(null)
    this.id = ''
    this.value = ''
    this.checked = false
    this.disabled = false
    this.className = ''
    this.__listeners = Object.create(null)
  }
  setAttribute(name, value) {
    value = String(value)
    this.attributes[name] = value
    if (name === 'id') this.id = value
    if (name === 'class') this.className = value
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value
  }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null
  }
  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name)
  }
  removeAttribute(name) {
    delete this.attributes[name]
    if (name === 'id') this.id = ''
    if (name === 'class') this.className = ''
  }
  setAttributeNS(_ns, name, value) {
    this.setAttribute(name, value)
  }
  removeAttributeNS(_ns, name) {
    this.removeAttribute(name)
  }
  addEventListener(type, fn) {
    ;(this.__listeners[type] || (this.__listeners[type] = new Set())).add(fn)
  }
  removeEventListener(type, fn) {
    if (this.__listeners[type]) this.__listeners[type].delete(fn)
  }
  dispatchEvent(event) {
    event.target = event.target || this
    event.currentTarget = this
    for (const fn of Array.from(this.__listeners[event.type] || [])) fn.call(this, event)
    return !event.defaultPrevented
  }
  get innerHTML() {
    return this.childNodes.map(n => n.textContent).join('')
  }
  set innerHTML(_value) {
    while (this.firstChild) this.removeChild(this.firstChild)
  }
}
class FakeDocument extends FakeNode {
  constructor() {
    super(null)
    this.ownerDocument = this
    this.nodeType = 9
    this.readyState = 'complete'
    this.documentElement = this.createElement('html')
    this.body = this.createElement('body')
    this.appendChild(this.documentElement)
    this.documentElement.appendChild(this.body)
  }
  createElement(tag) {
    return new FakeElement(this, tag)
  }
  createElementNS(_ns, tag) {
    return new FakeElement(this, tag)
  }
  createTextNode(value) {
    return new FakeText(this, value)
  }
  createComment(value) {
    return new FakeComment(this, value)
  }
  addEventListener() {}
  querySelector(selector) {
    if (selector[0] === '#') return find(this, n => n.nodeType === 1 && n.id === selector.slice(1))
    if (selector[0] === '[' && selector.endsWith(']')) {
      const name = selector.slice(1, -1).split('=')[0]
      return find(this, n => n.nodeType === 1 && n.hasAttribute(name))
    }
    return find(this, n => n.nodeType === 1 && n.localName === selector.toLowerCase())
  }
}
function find(node, pred) {
  if (pred(node)) return node
  for (const child of node.childNodes) {
    const got = find(child, pred)
    if (got) return got
  }
  return null
}
function fakeStorage() {
  const m = new Map()
  return {
    getItem: k => (m.has(String(k)) ? m.get(String(k)) : null),
    setItem: (k, v) => {
      m.set(String(k), String(v))
    },
    removeItem: k => {
      m.delete(String(k))
    },
    clear: () => m.clear()
  }
}
function fakeResponse(data, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: k => headers[String(k).toLowerCase()] || null },
    json: async () => data,
    text: async () => (typeof data === 'string' ? data : JSON.stringify(data))
  }
}
function fakeFetch(url, opts = {}) {
  url = String(url)
  if (url.includes('/api/notes') && opts.method === 'POST')
    return Promise.resolve(fakeResponse({ id: 'x', text: 'new note' }, 201))
  if (url.includes('/api/notes')) return Promise.resolve(fakeResponse([{ id: '1', text: 'fake note' }]))
  if (url.includes('/api/votes')) return Promise.resolve(fakeResponse([{ id: 'ids', label: 'IDs', votes: 1 }]))
  if (url.includes('/api/actions'))
    return Promise.resolve(fakeResponse([{ id: '1', title: 'Pin goblin dashboard', hint: 'folklore' }]))
  return Promise.resolve(fakeResponse({ ok: true }))
}
class FakeEventSource {
  constructor() {
    this.listeners = Object.create(null)
    setTimeout(() => {
      if (this.onopen) this.onopen({ type: 'open' })
      this.emit('metric', { count: 1, cpu: 42, mem: 27 })
    }, 0)
  }
  addEventListener(type, fn) {
    ;(this.listeners[type] || (this.listeners[type] = new Set())).add(fn)
  }
  emit(type, data) {
    for (const fn of Array.from(this.listeners[type] || [])) fn({ type, data: JSON.stringify(data) })
  }
  close() {}
}
async function settle() {
  for (let i = 0; i < 6; i++) {
    await new Promise(r => setTimeout(r, 0))
    Dumbact.flush()
  }
}
async function runHtml(name) {
  const html = readFileSync(join(demos, name), 'utf8')
  const doc = new FakeDocument()
  const app = doc.createElement('div')
  app.setAttribute('id', 'app')
  doc.body.appendChild(app)
  const timers = []
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    localStorage: globalThis.localStorage,
    fetch: globalThis.fetch,
    EventSource: globalThis.EventSource,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    performance: globalThis.performance,
    Dumbact: globalThis.Dumbact
  }
  Object.assign(globalThis, {
    document: doc,
    window: {
      document: doc,
      addEventListener() {},
      removeEventListener() {},
      matchMedia: () => ({
        matches: false,
        addEventListener() {},
        removeEventListener() {}
      })
    },
    localStorage: fakeStorage(),
    fetch: fakeFetch,
    EventSource: FakeEventSource,
    requestAnimationFrame: fn => {
      const id = setTimeout(() => fn(Date.now()), 0)
      timers.push(id)
      return id
    },
    cancelAnimationFrame: id => clearTimeout(id),
    performance: { now: () => Date.now() },
    Dumbact
  })
  try {
    Dumbact.clear()
    for (const script of scripts(html)) {
      if (attr(script.attrs, 'src')) continue
      const mode = Dumbact.scriptTypes[attr(script.attrs, 'type').toLowerCase().trim()]
      if (!mode) continue
      new Function(Dumbact.compile(script.text, mode) + `\n//# sourceURL=${name}.compiled.js`)()
    }
    await settle()
    const expectedReady = name.split('/')[0].replace(/\.(html|server\.mjs|mjs)$/, '');
    assert.equal(doc.documentElement.dataset.demoReady, expectedReady, name + ' ready flag')
    assert.ok(app.textContent.trim().length > 0, name + ' rendered no text')
    assert.deepEqual(Dumbact.peek('sys:errors', []), [], name + ' sys errors')
  } finally {
    for (const id of timers) clearTimeout(id)
    Dumbact.unmount(app)
    Dumbact.clear()
    Object.assign(globalThis, previous)
  }
}
function checkHtml(name, html) {
  assert.match(html, /<meta\s+name="viewport"\s+content="width=device-width,initial-scale=1">/, name + ' viewport')
  assert.match(html, /<meta\s+name="color-scheme"\s+content="light dark">/, name + ' color scheme')
  assert.match(html, /prefers-color-scheme\s*:\s*dark/, name + ' dark CSS')
  assert.match(html, /@media\s*\(max-width\s*:\s*760px\)/, name + ' mobile CSS')
  assert.match(html, /prefers-reduced-motion\s*:\s*reduce/, name + ' reduced motion')
  assert.doesNotMatch(html, removedRuntimeAPIs, name + ' removed API')
  for (const script of scripts(html)) {
    const mode = Dumbact.scriptTypes[attr(script.attrs, 'type').toLowerCase().trim()]
    if (mode && !/-module$/.test(mode))
      assert.doesNotThrow(() => new Function(Dumbact.compile(script.text, mode)), name + ' compile script')
    if (mode && /-module$/.test(mode))
      assert.doesNotThrow(() => Dumbact.compile(script.text, mode), name + ' compile module script')
  }
}

for (const name of htmlNames) assert.ok(existsSync(join(root, name)), name + ' exists')
for (const name of serverNames) assert.ok(existsSync(join(root, name)), name + ' exists')
for (const name of folderHtmlNames.concat(folderServerNames)) assert.ok(existsSync(join(demos, name)), name + ' exists')
for (const lock of ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb'])
  assert.ok(!walk(root).some(f => f.endsWith(lock)), lock + ' exists')
for (const api of [
  'derive',
  'ask',
  'resource',
  'watch',
  'restore',
  'cloneElement',
  'toChildArray',
  'isValidElement',
  'batch',
  'update',
  'replaceAllState',
  'unsafeHTML'
])
  assert.equal(typeof Dumbact[api], 'undefined', api + ' should not be core')
sh([process.execPath, '--check', join(root, 'dumbact.js')])
sh([process.execPath, '--check', join(root, 'test-runtime.js')])
sh([process.execPath, '--check', join(root, 'serve.mjs')])
for (const serverName of serverNames.concat(folderServerNames))
  sh([process.execPath, '--check', join(demos, serverName)])
sh([process.execPath, join(root, 'test-runtime.js')])
for (const [mode, source] of [
  ['js', 'const x = 1;'],
  [
    'ts',
    'type X = { a: string }; const f = (x: number) => x + 1; const ok = true, a = () => 1, b = 2; const y = ok ? a() : b;'
  ],
  ['jsx', 'const x = <div class="a">hi {1}</div>;'],
  ['tsx', 'type P = { x: number }; const x = <span>{2}</span>;']
])
  new Function('Dumbact', Dumbact.compile(source, mode))(Dumbact)
for (const htmlName of allHtmlNames) {
  const html = readFileSync(join(demos, htmlName), 'utf8')
  checkHtml(htmlName, html)
  if (htmlName === 'demo-cdn.html') {
    assert.match(html, /bootstrap@5\.3\.3\/dist\/css\/bootstrap\.min\.css/, 'Bootstrap CSS CDN link')
    assert.match(html, /lodash@4\.17\.21\/lodash\.min\.js/, 'Lodash script CDN link')
    assert.match(html, /class="pg"/, 'short mnemonic CSS class')
  }
  if (moduleSources[htmlName]) {
    for (const [file, mode] of moduleSources[htmlName]) {
      const source = readFileSync(join(demos, file), 'utf8')
      assert.doesNotThrow(() => Dumbact.compile(source, mode), file + ' module compile')
      if (file === 'demo-cdn-module/main.tsx')
        assert.match(source, /https:\/\/cdn\.jsdelivr\.net\/npm\/lodash-es@4\.17\.21\/chunk\.js/, 'CDN module URL')
    }
    console.log('ok module demo source', htmlName)
  } else {
    await runHtml(htmlName)
    console.log('ok demo', htmlName)
  }
}
await withServer(serverNames[0], async server => {
  const created = await fetch(server.url + 'api/notes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'server smoke note' })
  })
  assert.equal(created.status, 201)
  const after = await (await fetch(server.url + 'api/notes')).json()
  assert.ok(after.some(n => n.text === 'server smoke note'))
})
await withServer(serverNames[1], async server => {
  const res = await fetch(server.url + 'events')
  assert.match(String(res.headers.get('content-type') || ''), /text\/event-stream/)
  const reader = res.body.getReader()
  const first = await Promise.race([
    reader.read(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('SSE timeout')), 1500))
  ])
  assert.ok(
    Buffer.from(first.value || [])
      .toString('utf8')
      .includes('event: metric')
  )
  await reader.cancel().catch(() => {})
})
await withServer(serverNames[2], async server => {
  const home = await (await fetch(server.url)).text()
  checkHtml(serverNames[2], home)
  const votes = await (await fetch(server.url + 'api/votes')).json()
  const before = votes.find(v => v.id === 'ids').votes
  await fetch(server.url + 'api/votes/ids', { method: 'POST' })
  const after = await (await fetch(server.url + 'api/votes')).json()
  assert.equal(after.find(v => v.id === 'ids').votes, before + 1)
})
await withServer(serverNames[3], async server => {
  const home = await (await fetch(server.url)).text()
  checkHtml(serverNames[3], home)
  assert.match(
    readFileSync(join(demos, serverNames[3]), 'utf8'),
    /import _ from ['"]lodash['"];?/,
    'lodash npm import in .mjs demo'
  )
  const found = await (await fetch(server.url + 'api/actions?q=goblin')).json()
  assert.ok(found.some(a => /goblin/i.test(a.title + a.hint)))
})
await withServer(folderServerNames[0], async server => {
  const home = await (await fetch(server.url)).text()
  checkHtml(folderServerNames[0], home)
  const created = await fetch(server.url + 'api/items', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'server bananas' })
  })
  assert.equal(created.status, 201)
  const item = await created.json()
  const toggled = await (
    await fetch(server.url + 'api/items/' + encodeURIComponent(item.id) + '/toggle', { method: 'POST' })
  ).json()
  assert.equal(toggled.done, true)
})
await withServer(folderServerNames[1], async server => {
  const home = await (await fetch(server.url)).text()
  checkHtml(folderServerNames[1], home)
  const created = await fetch(server.url + 'api/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'server true wheel' })
  })
  assert.equal(created.status, 201)
  const job = await created.json()
  const advanced = await (
    await fetch(server.url + 'api/jobs/' + encodeURIComponent(job.id) + '/advance', { method: 'POST' })
  ).json()
  assert.equal(advanced.status, 'doing')
})
assert.ok(existsSync(join(root, '.npmrc')))
console.log('demo smoke tests passed')
