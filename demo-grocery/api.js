export function listItems() {
  return json('/api/items')
}

export function createItem(name) {
  return json('/api/items', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name })
  })
}

export function toggleRemoteItem(id) {
  return json('/api/items/' + encodeURIComponent(id) + '/toggle', {
    method: 'POST'
  })
}

function json(url, options) {
  return fetch(url, options)
    .then(requireOk)
    .then(response => response.json())
}

function requireOk(response) {
  if (!response.ok) throw new Error('HTTP ' + response.status + ' for ' + response.url)
  return response
}
