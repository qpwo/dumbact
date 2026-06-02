#!/usr/bin/env node
/** Format every project source file with prettier-no-jsx-parens without shell glob footguns. */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'

var root = process.cwd()
var extensions = new Set(['.html', '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.css'])
var skipDirs = new Set([
  '.git',
  'node_modules',
  'coverage',
  'dist',
  'build',
  '.next',
  'playwright-report',
  'test-results'
])

main()

function main() {
  var files = collectFiles()
  if (existsSync('package.json')) files.unshift('package.json')
  files = Array.from(new Set(files)).sort()
  console.log('formatting ' + files.length + ' files')
  runPrettier(files)
}

function collectFiles() {
  var out = []
  walk(root, out)
  return out
}

function walk(dir, out) {
  for (var name of readdirSync(dir)) {
    if (skipDirs.has(name)) continue
    var full = join(dir, name)
    var stat = statSync(full)
    if (stat.isDirectory()) {
      walk(full, out)
      continue
    }
    if (!stat.isFile()) continue
    if (!extensions.has(extname(name).toLowerCase())) continue
    out.push(relative(root, full))
  }
}

function runPrettier(files) {
  for (var i = 0; i < files.length; i += 80) {
    var chunk = files.slice(i, i + 80)
    var result = spawnSync('prettier-no-jsx-parens', ['-w'].concat(chunk), { stdio: 'inherit' })
    if (result.error) throw result.error
    if (result.status) process.exit(result.status)
    if (result.signal) {
      console.error('prettier-no-jsx-parens exited by signal ' + result.signal)
      process.exit(1)
    }
  }
}
