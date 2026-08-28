import { scope } from 'dumbact'
import { createItem, listItems, toggleRemoteItem } from './api.js'
import { seedItems } from './items.js'

const S = scope('grocery-jsx')

if (!S.peek('items')) S.set('items', seedItems)
if (!S.peek('draft')) S.set('draft', '')
if (!S.peek('filter')) S.set('filter', 'all')
if (!S.peek('status')) S.set('status', 'idle')

export function loadItems() {
  S.set('status', 'loading')
  return listItems().then(items => {
    S.set('items', items)
    S.set('status', 'ready')
  }, fail)
}

export function items() {
  return S.get('items', [])
}

export function draft() {
  return S.get('draft', '')
}

export function filter() {
  return S.get('filter', 'all')
}

export function status() {
  return S.get('status', 'idle')
}

export function setDraft(text) {
  S.set('draft', text)
}

export function setFilter(value) {
  S.set('filter', value)
}

export function addItem(event) {
  event.preventDefault()
  const name = draft().trim()
  if (!name) return
  S.set('status', 'saving')
  return createItem(name).then(item => {
    S.set('items', rows => [item].concat(rows || []))
    S.set('draft', '')
    S.set('status', 'ready')
  }, fail)
}

export function toggleItem(id) {
  S.set('status', 'saving')
  return toggleRemoteItem(id).then(updated => {
    S.set('items', rows => (rows || []).map(item => (item.id === updated.id ? updated : item)))
    S.set('status', 'ready')
  }, fail)
}

export function visibleItems() {
  const mode = filter()
  return items().filter(item => (mode === 'done' ? item.done : mode === 'needed' ? !item.done : true))
}

export function total() {
  return items().reduce((sum, item) => sum + item.price, 0)
}

export function remaining() {
  return items()
    .filter(item => !item.done)
    .reduce((sum, item) => sum + item.price, 0)
}

export function boughtCount() {
  return items().filter(item => item.done).length
}

function fail(error) {
  console.error(error)
  S.set('status', 'error')
}
