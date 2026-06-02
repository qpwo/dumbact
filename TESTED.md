# Test record

Date: 2026-06-02
Runtime: Node.js 22.16.0
Browser: Chromium 144.0.7559.96 through `playwright-core`
Command: `npm test`

## Result

All checks passed.

Final command output included:

```txt
browser fuzz passed seed=0x5eed1234 operations=320 finalLength=49 eventSum=1830
benchmark passed rows=1200 dumbactInitial=10ms update=6.8ms reverse=7.4ms
status=0 elapsed=0:26.97
```

## Commands executed by `tests/run-all.mjs`

```sh
node --check dumbact.js
node --check dumbact.test.js
node --check serve.mjs
node --check tests/demo-smoke.mjs
node --check tests/browser-smoke.mjs
node --check tests/fuzz.mjs
node --check tests/bench.mjs
node --check tests/fuzz-bench.mjs
node --check tests/run-all.mjs
node dumbact.test.js
node tests/demo-smoke.mjs
node tests/browser-smoke.mjs
node tests/fuzz-bench.mjs
```

`tests/run-all.mjs` cleans leftover demo servers and Chromium helper processes between commands so the npm process exits cleanly.

## Core checks

`dumbact.test.js` passed these cases:

- cell store get, set, delete, ids, snapshot
- scoped ids
- immediate and unsubscribed subscriptions
- removed API absence
- render and text update
- function component children
- JSX runtime children
- tracked reads rerender without hooks
- `peek` does not subscribe
- dependency changes remove old cells
- duplicate primitive set does not notify
- same object set notifies after mutation
- clear prefix rerenders fallbacks
- native event handlers
- event handler replacement and removal
- render-time derived values
- deep child reads without prop drilling
- keyed DOM reorder with existing nodes
- fragments without wrapper elements
- keyed fragment range reorder
- attributes, className, booleans, value, checked
- style object update and cleanup
- raw HTML props ignored
- strings rendered as text
- refs assign, preserve, and clean up
- unmount removes cell view membership
- compiler APIs are present
- render errors are captured in `sys:errors`

## Static demo checks

`tests/demo-smoke.mjs` checked the `demos/` HTML inventory:

- `demos/01-state-ids-counter-tsx.html`
- `demos/02-local-todo-jsx.html`
- `demos/03-no-prop-drilling-ts.html`
- `demos/04-keyed-list-benchmark-js.html`
- `demos/05-form-validation-tsx.html`
- `demos/06-svg-dashboard-jsx.html`
- `demos/07-api-notes-paired.html`
- `demos/08-sse-metrics-paired.html`
- `demos/11-module-graph-tsx.html`
- `demos/12-cdn-html-libs.html`
- `demos/13-cdn-module-tsx.html`

It checked syntax, no lockfiles, removed API absence, compiler execution, demo readiness, viewport metadata, light/dark CSS support, mobile CSS support, reduced-motion CSS support, module source compilation, CDN URL examples, short mnemonic class examples, and real Express endpoints for notes, SSE metrics, vote wall, and command palette search. The root `minimal-counter.html` is covered by the browser smoke test.

## Browser checks

`tests/browser-smoke.mjs` opened these pages in Chromium:

- `minimal-counter.html`
- demos 01-08
- demo 12
- module demo 11
- module demo 13

It ran real user actions for:

- minimal counter increment
- counter increment and step change
- todo add
- deep state input and cart increment
- keyed list reverse and append
- form validation and submit
- SVG dashboard range update
- Express REST note add
- Express SSE receive
- Bootstrap/Lodash CDN HTML demo filter
- TSX module graph import, render, and imported action call
- TSX module graph with full Lodash ES CDN URL import

The browser test routes CDN URLs to deterministic local shims for Bootstrap CSS, Lodash script, and Lodash ES `chunk.js` so the test is real browser execution without depending on public network availability.

The browser test fails on uncaught page errors, console errors, missing readiness markers, horizontal overflow, failed user interactions, failed REST, failed SSE, or failed module imports.

## Fuzz check

`tests/fuzz-bench.mjs` passed the browser fuzz pass.

Seed: `0x5eed1234`
Operations: `320`
Final list length: `49`
Event replacement sum: `1830`

The fuzz check performs random keyed-list edits, verifies DOM order and text after each edit, verifies keyed nodes are moved instead of replaced, verifies event handler replacement does not accumulate handlers, and verifies unmount removes live subscriptions.

## Benchmark check

`tests/fuzz-bench.mjs` passed the browser benchmark and wrote `BENCHMARK.md`.

| case | median / min / max |
|---|---|
| rows | 1200 |
| direct DOM initial render | 6.8 / 6.4 / 7.6 ms |
| Dumbact initial render | 10 / 7.6 / 48.6 ms |
| Dumbact single text update | 6.8 / 3.2 / 16.3 ms |
| Dumbact keyed reverse | 7.4 / 5.7 / 20.9 ms |
| Dumbact append 100 | 16.7 / 14.6 / 23.2 ms |

The benchmark is a regression check, not a universal performance claim. Run `npm run test:bench` on the target machine for local numbers.

## Boundaries proven by tests

Supported:

- single-file HTML using `dumbact.js`
- plain JS scripts
- simple type-stripped TS scripts
- simple JSX and TSX scripts
- multi-file JS, TS, JSX, and TSX module graphs through `text/dumbact-*-module`
- relative module imports
- full CDN JavaScript module URL imports
- built-in `import { ... } from "dumbact"`
- id-addressed cells
- function views and function components
- native DOM events
- refs
- SVG namespace creation
- keyed child movement
- fragments
- REST and SSE demos through Express
- Bootstrap CSS CDN beside static local CSS
- Lodash script CDN in `.html`
- Lodash npm import in `.mjs`
- Lodash ES CDN module import in `.tsx`

Not supported:

- hooks
- context providers
- lifecycle methods
- raw HTML rendering helpers
- bare npm package imports in browser modules, except the built-in `dumbact` specifier
- full TypeScript compiler semantics
- full Babel JSX semantics
- framework routing
- server rendering
- storage, auth, encryption, audio streaming, billing, deployment, or server architecture
