import { render } from 'dumbact'
import { App } from './view.tsx'

render(App, '#app')
document.documentElement.dataset.demoReady = 'demo-module'
