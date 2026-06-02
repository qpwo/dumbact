/** HTTP client helpers for the multi-file TSX service queue demo. */
export type Job = {
  id: string
  title: string
  owner: string
  status: string
  minutes: number
}

export function listJobs(): Promise<Job[]> {
  return json('/api/jobs')
}

export function createJob(title: string): Promise<Job> {
  return json('/api/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title })
  })
}

export function advanceRemoteJob(id: string): Promise<Job> {
  return json('/api/jobs/' + encodeURIComponent(id) + '/advance', {
    method: 'POST'
  })
}

function json(url: string, options = {}) {
  return fetch(url, options)
    .then(requireOk)
    .then(response => response.json())
}

function requireOk(response: Response): Response {
  if (!response.ok) throw new Error('HTTP ' + response.status + ' for ' + response.url)
  return response
}
