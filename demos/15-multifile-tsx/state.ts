/** Typed state and server synchronization for the multi-file TSX service queue demo. */
import { scope } from 'dumbact'
import { advanceRemoteJob, createJob, listJobs } from './api.ts'

type Job = {
  id: string
  title: string
  owner: string
  status: string
  minutes: number
}

const S = scope('queue-tsx')

if (!S.peek('jobs')) S.set('jobs', [])
if (!S.peek('draft')) S.set('draft', 'Patch front tube')
if (!S.peek('status')) S.set('status', 'idle')

export function loadJobs(): Promise<void> {
  S.set('status', 'loading')
  return listJobs().then(rows => {
    S.set('jobs', rows)
    S.set('status', 'ready')
  }, fail)
}

export function jobs(): Job[] {
  return S.get('jobs', [])
}

export function draft(): string {
  return S.get('draft', '')
}

export function status(): string {
  return S.get('status', 'idle')
}

export function setDraft(text: string): void {
  S.set('draft', text)
}

export function addJob(event: Event): void {
  event.preventDefault()
  const title = draft().trim()
  if (!title) return
  S.set('status', 'saving')
  createJob(title).then(job => {
    S.set('jobs', rows => [job].concat(rows || []))
    S.set('draft', '')
    S.set('status', 'ready')
  }, fail)
}

export function advance(id: string): void {
  S.set('status', 'saving')
  advanceRemoteJob(id).then(updated => {
    S.set('jobs', rows => (rows || []).map(job => (job.id === updated.id ? updated : job)))
    S.set('status', 'ready')
  }, fail)
}

export function summary() {
  const rows = jobs()
  return {
    open: rows.filter(job => job.status !== 'done').length,
    done: rows.filter(job => job.status === 'done').length,
    minutes: rows.filter(job => job.status !== 'done').reduce((sum, job) => sum + job.minutes, 0)
  }
}

function fail(error): void {
  console.error(error)
  S.set('status', 'error')
}
