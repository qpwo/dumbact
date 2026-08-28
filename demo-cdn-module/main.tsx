import chunk from 'https://cdn.jsdelivr.net/npm/lodash-es@4.17.21/chunk.js'
import { render } from 'dumbact'
import { rows } from './data.ts'
import { CdnApp } from './view.tsx'

render(() => <CdnApp chunk={chunk} rows={rows} />, '#app')
document.documentElement.dataset.demoReady = 'demo-cdn-module'
