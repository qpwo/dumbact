#!/usr/bin/env node
'use strict'

const assert = require('node:assert/strict')
const Dumbact = require('./dumbact.js')
const { h, Fragment } = Dumbact

class FakeNode {
  constructor(ownerDocument) {
    this.ownerDocument = ownerDocument || null
    this.parentNode = null
    this.childNodes = []
  }
  get firstChild() {
    return this.childNodes[0] || null
  }
  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] || null
  }
  get nextSibling() {
    if (!this.parentNode) return null
    const a = this.parentNode.childNodes
    const i = a.indexOf(this)
    return i >= 0 ? a[i + 1] || null : null
  }
  get previousSibling() {
    if (!this.parentNode) return null
    const a = this.parentNode.childNodes
    const i = a.indexOf(this)
    return i > 0 ? a[i - 1] : null
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
  constructor(ownerDocument, value) {
    super(ownerDocument)
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
  constructor(ownerDocument, value) {
    super(ownerDocument)
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
  constructor(ownerDocument, tagName) {
    super(ownerDocument)
    this.nodeType = 1
    this.localName = String(tagName).toLowerCase()
    this.tagName = String(tagName).toUpperCase()
    this.nodeName = this.tagName
    this.attributes = Object.create(null)
    this.style = Object.create(null)
    this.__listeners = Object.create(null)
    this.id = ''
    this.value = ''
    this.checked = false
    this.disabled = false
    this.className = ''
    this._innerHTML = null
  }
  setAttribute(name, value) {
    value = String(value)
    this.attributes[name] = value
    if (name === 'id') this.id = value
    if (name === 'class') this.className = value
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
    event = event || { type: '' }
    if (!event.type) throw new Error('event.type required')
    event.target = event.target || this
    event.currentTarget = this
    const list = Array.from(this.__listeners[event.type] || [])
    for (const fn of list) fn.call(this, event)
    return !event.defaultPrevented
  }
  get innerHTML() {
    if (this._innerHTML != null) return this._innerHTML
    return this.childNodes.map(serialize).join('')
  }
  set innerHTML(value) {
    this._innerHTML = String(value)
    while (this.firstChild) this.removeChild(this.firstChild)
  }
}

class FakeDocument extends FakeNode {
  constructor() {
    super(null)
    this.ownerDocument = this
    this.nodeType = 9
    this.documentElement = this.createElement('html')
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
  querySelector(selector) {
    if (selector[0] === '#') return find(this, n => n.nodeType === 1 && n.id === selector.slice(1))
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

function serialize(node) {
  if (node.nodeType === 3) return escapeHtml(node.nodeValue)
  if (node.nodeType === 8) return `<!--${node.nodeValue}-->`
  const attrs = Object.keys(node.attributes || {})
    .map(k => ` ${k}="${escapeHtml(node.attributes[k])}"`)
    .join('')
  return `<${node.localName}${attrs}>${node.childNodes.map(serialize).join('')}</${node.localName}>`
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch])
}

function elementChildren(node) {
  return node.childNodes.filter(n => n.nodeType === 1)
}

function text(node) {
  return node.textContent
}
function tick() {
  return Promise.resolve().then(() => Dumbact.flush())
}
function host() {
  return new FakeDocument().createElement('main')
}

async function test(name, fn) {
  try {
    Dumbact.unmountsSilentlyForTests = true
    Dumbact.clear()
    await fn()
    console.log('ok -', name)
  } catch (error) {
    console.error('not ok -', name)
    throw error
  }
}

;(async function main() {
  await test('cell store get/set/delete/ids/snapshot', () => {
    const seen = []
    const unsub = Dumbact.sub('goblin:n', (v, p, id) => seen.push([id, v, p]))
    assert.equal(Dumbact.get('goblin:n', 1), 1)
    assert.equal(Dumbact.has('goblin:n'), false)
    Dumbact.set('goblin:n', 2)
    Dumbact.set('goblin:n', n => n + 3)
    Dumbact.set('goblin:n', 5)
    assert.equal(seen.length, 2, 'Object.is prevents duplicate notifications')
    assert.equal(Dumbact.need('goblin:n'), 5)
    assert.deepEqual(Dumbact.ids('goblin:'), ['goblin:n'])
    const snap = Dumbact.snapshot()
    assert.deepEqual(snap, { 'goblin:n': 5 })
    Dumbact.del('goblin:n')
    assert.equal(Dumbact.has('goblin:n'), false)
    assert.throws(() => Dumbact.need('missing'), /missing dumbact id/)
    unsub()
  })

  await test('scope prefixes ids', () => {
    const s = Dumbact.scope('troll:7')
    s.set('name', 'Ugg')
    assert.equal(s.id('name'), 'troll:7:name')
    assert.equal(Dumbact.peek('troll:7:name'), 'Ugg')
    s.clear()
    assert.equal(Dumbact.has('troll:7:name'), false)
  })

  await test('sub immediate and unsubscribe', () => {
    Dumbact.set('x', 1)
    const seen = []
    const unsub = Dumbact.sub('x', (v, prev, id) => seen.push([v, id, prev]), true)
    Dumbact.set('x', 2)
    unsub()
    Dumbact.set('x', 3)
    assert.deepEqual(seen, [
      [1, 'x', undefined],
      [2, 'x', 1]
    ])
  })

  await test('public API stays small and avoids compatibility baggage', () => {
    assert.equal(typeof Dumbact.derive, 'undefined')
    assert.equal(typeof Dumbact.ask, 'undefined')
    assert.equal(typeof Dumbact.resource, 'undefined')
    assert.equal(typeof Dumbact.watch, 'undefined')
    assert.equal(typeof Dumbact.restore, 'undefined')
    assert.equal(typeof Dumbact.cloneElement, 'undefined')
    assert.equal(typeof Dumbact.toChildArray, 'undefined')
    assert.equal(typeof Dumbact.batch, 'undefined')
    assert.equal(typeof Dumbact.update, 'undefined')
    assert.equal(typeof Dumbact.replaceAllState, 'undefined')
    assert.equal(typeof Dumbact.unsafeHTML, 'undefined')
    assert.equal(typeof Dumbact.isVNode, 'undefined')
  })

  await test('basic render and text update', () => {
    const root = host()
    Dumbact.render(h('p', { id: 'a' }, 'hello ', 3), root)
    assert.equal(text(root), 'hello 3')
    assert.equal(elementChildren(root)[0].localName, 'p')
    Dumbact.render(h('p', { id: 'a' }, 'bye'), root)
    assert.equal(text(root), 'bye')
  })

  await test('function components receive children', () => {
    const root = host()
    function Box(props) {
      return h('section', null, props.children)
    }
    Dumbact.render(h(Box, null, h('b', null, 'kid')), root)
    assert.equal(serialize(elementChildren(root)[0]), '<section><b>kid</b></section>')
  })

  await test('jsx runtime reads props.children', () => {
    const root = host()
    const node = Dumbact.jsx('div', {
      children: [Dumbact.jsx('span', { children: 'x' })]
    })
    Dumbact.render(node, root)
    assert.equal(serialize(elementChildren(root)[0]), '<div><span>x</span></div>')
  })

  await test('auto-tracked id reads rerender without hooks', async () => {
    const root = host()
    let renders = 0
    Dumbact.set('count', 1)
    Dumbact.render(() => {
      renders++
      return h('button', null, 'count=', Dumbact.get('count'))
    }, root)
    assert.equal(text(root), 'count=1')
    Dumbact.set('count', 2)
    await tick()
    assert.equal(text(root), 'count=2')
    assert.equal(renders, 2)
  })

  await test('peek does not subscribe current render', async () => {
    const root = host()
    let renders = 0
    Dumbact.set('silent', 1)
    Dumbact.render(() => {
      renders++
      return h('p', null, Dumbact.peek('silent'))
    }, root)
    Dumbact.set('silent', 2)
    await tick()
    assert.equal(text(root), '1')
    assert.equal(renders, 1)
  })

  await test('changing render dependencies drops old cells', async () => {
    const root = host()
    let renders = 0
    Dumbact.set('which', 'a')
    Dumbact.set('a', 'A1')
    Dumbact.set('b', 'B1')
    Dumbact.render(() => {
      renders++
      const which = Dumbact.get('which')
      return h('p', null, Dumbact.get(which))
    }, root)
    assert.equal(text(root), 'A1')
    Dumbact.set('which', 'b')
    await tick()
    assert.equal(text(root), 'B1')
    Dumbact.set('a', 'A2')
    await tick()
    assert.equal(text(root), 'B1')
    assert.equal(renders, 2)
  })

  await test('duplicate set neither notifies nor rerenders', async () => {
    const root = host()
    let renders = 0
    let notices = 0
    Dumbact.set('same', 1)
    const unsub = Dumbact.sub('same', () => {
      notices++
    })
    Dumbact.render(() => {
      renders++
      return h('p', null, Dumbact.get('same'))
    }, root)
    Dumbact.set('same', 1)
    await tick()
    assert.equal(renders, 1)
    assert.equal(notices, 0)
    unsub()
  })

  await test('same object set notifies after mutation', async () => {
    const root = host()
    const list = ['a']
    Dumbact.set('mutable:list', list)
    Dumbact.render(() => h('p', null, Dumbact.get('mutable:list', []).join('')), root)
    list.push('b')
    Dumbact.set('mutable:list', list)
    await tick()
    assert.equal(text(root), 'ab')
  })

  await test('clear prefix rerenders fallbacks', async () => {
    const root = host()
    Dumbact.set('bag:one', 'full')
    Dumbact.render(() => h('p', null, Dumbact.get('bag:one', 'empty')), root)
    Dumbact.clear('bag:')
    await tick()
    assert.equal(text(root), 'empty')
  })

  await test('event handlers use native addEventListener and update state', async () => {
    const root = host()
    Dumbact.set('clicks', 0)
    Dumbact.render(
      () => h('button', { onClick: () => Dumbact.set('clicks', n => n + 1) }, 'clicks ', Dumbact.get('clicks')),
      root
    )
    const button = elementChildren(root)[0]
    button.dispatchEvent({ type: 'click' })
    button.dispatchEvent({ type: 'click' })
    await tick()
    assert.equal(text(root), 'clicks 2')
  })

  await test('event handler replacement and removal', () => {
    const root = host()
    let n = 0
    Dumbact.render(
      h(
        'button',
        {
          onClick: () => {
            n += 1
          }
        },
        'x'
      ),
      root
    )
    const button = elementChildren(root)[0]
    button.dispatchEvent({ type: 'click' })
    Dumbact.render(
      h(
        'button',
        {
          onClick: () => {
            n += 10
          }
        },
        'x'
      ),
      root
    )
    button.dispatchEvent({ type: 'click' })
    Dumbact.render(h('button', null, 'x'), root)
    button.dispatchEvent({ type: 'click' })
    assert.equal(n, 11)
  })

  await test('render-time derived values track their source ids', async () => {
    const root = host()
    Dumbact.set('a', 2)
    Dumbact.set('b', 5)
    Dumbact.render(() => h('p', null, Dumbact.get('a', 0) + Dumbact.get('b', 0)), root)
    assert.equal(text(root), '7')
    Dumbact.set('a', 10)
    await tick()
    assert.equal(text(root), '15')
  })

  await test('child reads shared id directly, no prop drilling', async () => {
    const root = host()
    function DeepChild() {
      return h('strong', null, Dumbact.get('user:name', '?'))
    }
    function Parent() {
      return h('div', null, h('aside', null, h(DeepChild)))
    }
    Dumbact.set('user:name', 'Gob')
    Dumbact.render(h(Parent), root)
    assert.equal(text(root), 'Gob')
    Dumbact.set('user:name', 'Gremlin')
    await tick()
    assert.equal(text(root), 'Gremlin')
  })

  await test('keyed children reorder by moving existing DOM nodes', () => {
    const root = host()
    function list(items) {
      return h(
        'ul',
        null,
        items.map(item => h('li', { key: item, 'data-k': item }, item))
      )
    }
    Dumbact.render(list(['a', 'b', 'c']), root)
    const ul = elementChildren(root)[0]
    const a = ul.childNodes.find(n => n.nodeType === 1 && n.textContent === 'a')
    const b = ul.childNodes.find(n => n.nodeType === 1 && n.textContent === 'b')
    const c = ul.childNodes.find(n => n.nodeType === 1 && n.textContent === 'c')
    Dumbact.render(list(['c', 'a', 'b']), root)
    const order = ul.childNodes
      .filter(n => n.nodeType === 1)
      .map(n => n.textContent)
      .join('')
    assert.equal(order, 'cab')
    assert.equal(ul.childNodes.filter(n => n.nodeType === 1)[0], c)
    assert.equal(ul.childNodes.filter(n => n.nodeType === 1)[1], a)
    assert.equal(ul.childNodes.filter(n => n.nodeType === 1)[2], b)
  })

  await test('fragments render multiple siblings without element wrapper', () => {
    const root = host()
    Dumbact.render(h(Fragment, null, h('i', null, 'A'), h('b', null, 'B')), root)
    assert.equal(text(root), 'AB')
    assert.deepEqual(
      elementChildren(root).map(n => n.localName),
      ['i', 'b']
    )
  })

  await test('fragment children can reorder keyed ranges', () => {
    const root = host()
    function Item(props) {
      return h(Fragment, { key: props.id }, h('dt', null, props.id), h('dd', null, props.value))
    }
    function view(order) {
      return h(
        'dl',
        null,
        order.map(x => h(Item, { key: x, id: x, value: x.toUpperCase() }))
      )
    }
    Dumbact.render(view(['a', 'b']), root)
    const dl = elementChildren(root)[0]
    const firstDt = dl.childNodes.find(n => n.nodeType === 1 && n.textContent === 'a')
    Dumbact.render(view(['b', 'a']), root)
    assert.equal(dl.textContent, 'bBaA')
    assert.equal(dl.childNodes.filter(n => n.nodeType === 1)[2], firstDt)
  })

  await test('attributes, className, boolean, value, checked', () => {
    const root = host()
    Dumbact.render(
      h('input', {
        className: 'x',
        disabled: true,
        value: 'a',
        checked: true,
        'data-g': '1'
      }),
      root
    )
    const input = elementChildren(root)[0]
    assert.equal(input.getAttribute('class'), 'x')
    assert.equal(input.hasAttribute('disabled'), false, 'disabled is a property in the fake DOM')
    assert.equal(input.disabled, true)
    assert.equal(input.value, 'a')
    assert.equal(input.checked, true)
    assert.equal(input.getAttribute('data-g'), '1')
    Dumbact.render(h('input', { disabled: false, value: 'b', checked: false }), root)
    assert.equal(input.disabled, false)
    assert.equal(input.value, 'b')
    assert.equal(input.checked, false)
    assert.equal(input.getAttribute('data-g'), null)
  })

  await test('style object updates and removes old entries', () => {
    const root = host()
    Dumbact.render(h('div', { style: { width: 3, opacity: 0.5 } }), root)
    const div = elementChildren(root)[0]
    assert.equal(div.style.width, '3px')
    assert.equal(div.style.opacity, '0.5')
    Dumbact.render(h('div', { style: { height: 2 } }), root)
    assert.equal(div.style.width, '')
    assert.equal(div.style.opacity, '')
    assert.equal(div.style.height, '2px')
  })

  await test('raw HTML props are ignored', () => {
    const root = host()
    Dumbact.render(
      h(
        'div',
        {
          html: '<span>raw</span>',
          dangerouslySetInnerHTML: { __html: '<i>raw</i>' },
          unsafeHTML: '<b>raw</b>'
        },
        h('em', null, 'safe')
      ),
      root
    )
    const div = elementChildren(root)[0]
    assert.equal(div.innerHTML, '<em>safe</em>')
    assert.equal(div.hasAttribute('html'), false)
    assert.equal(div.hasAttribute('dangerouslySetInnerHTML'), false)
    assert.equal(div.hasAttribute('unsafeHTML'), false)
  })

  await test('plain strings are text, not raw HTML', () => {
    const root = host()
    Dumbact.render(h('div', null, '<span>not raw</span>'), root)
    assert.equal(serialize(elementChildren(root)[0]), '<div>&lt;span&gt;not raw&lt;/span&gt;</div>')
  })

  await test('refs assign, preserve, and clean up', () => {
    const root = host()
    const obj = { current: null }
    let cleaned = 0
    const fnRef = node => {
      if (node)
        return () => {
          cleaned += 1
        }
    }
    Dumbact.render(h('div', null, h('span', { ref: obj }, 'x'), h('em', { ref: fnRef }, 'y')), root)
    const span = obj.current
    assert.equal(span.localName, 'span')
    Dumbact.render(h('div', null, h('span', { ref: obj }, 'z'), h('em', { ref: fnRef }, 'q')), root)
    assert.equal(obj.current, span)
    assert.equal(cleaned, 0, 'stable refs are not cleaned during ordinary rerender')
    Dumbact.unmount(root)
    assert.equal(obj.current, null)
    assert.equal(cleaned, 1)
  })

  await test('unmount removes cell view membership', async () => {
    const root = host()
    let renders = 0
    Dumbact.set('live', 1)
    Dumbact.render(() => {
      renders++
      return h('p', null, Dumbact.get('live'))
    }, root)
    Dumbact.unmount(root)
    Dumbact.set('live', 2)
    await tick()
    assert.equal(renders, 1)
    assert.equal(root.childNodes.length, 0)
  })

  await test('compiler APIs are attached in the same file', () => {
    assert.equal(typeof Dumbact.compile, 'function')
    assert.match(Dumbact.compile('type X = {a:string};\nconst x: number = 1;', 'ts'), /const x\s*= 1/)
    assert.match(Dumbact.compile('const x=<b>goblin</b>;', 'jsx'), /Dumbact\.h/)
  })

  await test('render errors are captured in sys:errors', () => {
    const root = host()
    assert.throws(
      () =>
        Dumbact.render(() => {
          throw new Error('bad render goblin')
        }, root),
      /bad render goblin/
    )
    assert.equal(Dumbact.peek('sys:errors')[0].message, 'bad render goblin')
  })

  console.log('all dumbact tests passed')
})().catch(error => {
  console.error((error && error.stack) || error)
  process.exit(1)
})
