import { render } from 'dumbact'
import { loadJobs } from './state.ts'
import { QueueApp } from './view.tsx'

loadJobs()
render(QueueApp, '#app')
document.documentElement.dataset.demoReady = 'demo-queue'
