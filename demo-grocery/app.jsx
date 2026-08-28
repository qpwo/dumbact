import { render } from 'dumbact'
import { loadItems } from './state.js'
import { GroceryApp } from './view.jsx'

loadItems()
render(GroceryApp, '#app')
document.documentElement.dataset.demoReady = 'demo-grocery'
