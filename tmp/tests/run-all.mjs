import { spawn } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'

const node = process.execPath
const commands = [
  [node, '--check', 'dumbact.js'],
  [node, '--check', 'dumbact.test.js'],
  [node, '--check', 'serve.mjs'],
  [node, '--check', 'tests/demo-smoke.mjs'],
  [node, '--check', 'tests/browser-smoke.mjs'],
  [node, '--check', 'tests/fuzz.mjs'],
  [node, '--check', 'tests/bench.mjs'],
  [node, '--check', 'tests/fuzz-bench.mjs'],
  [node, '--check', 'tests/run-all.mjs'],
  [node, 'dumbact.test.js'],
  [node, 'tests/demo-smoke.mjs'],
  [node, 'tests/browser-smoke.mjs'],
  [node, 'tests/fuzz-bench.mjs']
]

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
async function cleanupProcesses() {
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
    if (/playwright_chromiumdev_profile|chrome_crashpad_handler|dumbact-module-pack\/demos\/(07|08|09|10)-/.test(cmd))
      victims.push(Number(pid))
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

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(args[0], args.slice(1), {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    child.stdout.on('data', b => process.stdout.write(b))
    child.stderr.on('data', b => process.stderr.write(b))
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      child.stdout.destroy()
      child.stderr.destroy()
      if (code === 0) resolve()
      else reject(new Error(`${args.join(' ')} exited with ${signal || code}`))
    })
  })
}

for (const args of commands) {
  await cleanupProcesses()
  await run(args)
  await cleanupProcesses()
}
