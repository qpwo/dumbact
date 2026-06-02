# Dumbact

Dumbact is a single-file browser UI runtime. It provides id-addressed state cells, a DOM patcher, a browser script runner, and a small module graph loader for plain JS, type-stripped TS, JSX, and TSX.

There are no hooks, context providers, lifecycle methods, raw HTML helpers, build step, linter requirement, framework adapter, class-name mangler, or lockfile requirement.

Dumbact can be the client UI layer for real applications. It does not provide storage, auth, encryption, audio streaming, permissions, background sync, billing, deployment, or server architecture. Those remain normal application and platform choices.

## Minimal working example

`minimal-counter.html` is a complete example next to `dumbact.js`. Open it in a browser.

```html
<!doctype html>
<html>
<body>
  <main id="app"></main>
  <script src="./dumbact.js"></script>
  <script type="text/dumbact-tsx">
    const App = () => (
      <button onClick={() => Dumbact.set('example:count', n => (n || 0) + 1)}>
        Count: {Dumbact.get('example:count', 0)}
      </button>
    );
    Dumbact.render(App, '#app');
  </script>
</body>
</html>
```

## State model

State is stored in cells keyed by strings.

```txt
id -> Cell { value, views, subscribers, version }
```

A mounted view that calls `Dumbact.get(id)` records a dependency on that cell. `Dumbact.set(id, value)` updates the cell and queues the views that read it. `Dumbact.peek(id)` reads without recording a dependency.

```js
const Count = () =>
  Dumbact.h('button', {
    onClick: () => Dumbact.set('count', n => (n || 0) + 1)
  }, 'Count: ', Dumbact.get('count', 0));

Dumbact.render(Count, '#app');
```

## Public API

```txt
h, createElement, Fragment, jsx, jsxs, jsxDEV
render, mount, unmount, flush
get, peek, need, has, set, del, clear, sub, ids, snapshot, scope
compile, stripTypes, transformJSX, runScripts, runScript, scriptTypes
loadModule, moduleSourceURL
```

Removed or intentionally absent:

```txt
useState, useEffect, useContext, context providers, lifecycle methods
derive, ask, resource, watch, restore, cloneElement, toChildArray
batch, update, replaceAllState, raw HTML helpers
```

Plain strings render as text. `html`, `unsafeHTML`, and `dangerouslySetInnerHTML` props are ignored.

## CSS and library stance

The demos use static CSS, normal selectors, browser media queries, CSS variables, and visible class names. The CSS is intended to remain inspectable in devtools and usable without a build step.

Local app classes are short and mnemonic rather than mangled: examples include `pg`, `hd`, `gd`, `c`, `rw`, `bd`, `stk`, `ls`, and `it`. Third-party classes remain their own readable names, such as Bootstrap's `btn` and `btn-primary`.

The examples cover desktop width, mobile width, light mode, dark mode, and reduced motion. This is ordinary CSS, not a runtime styling system.

External libraries are allowed by the platform boundary, not required by Dumbact. The demos show three explicit forms:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css">
<script src="https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js"></script>
```

```tsx
import chunk from "https://cdn.jsdelivr.net/npm/lodash-es@4.17.21/chunk.js";
```

```mjs
import _ from 'lodash';
```

Use script/link tags in single-file HTML, full CDN module URLs in browser modules, and npm imports in server-side `.mjs` when Node is the module resolver. Dumbact does not imitate npm resolution in the browser.

## Single-file script types

Dumbact scans inert scripts and runs them in order.

```html
<script type="text/dumbact-js"></script>
<script type="text/dumbact-ts"></script>
<script type="text/dumbact-jsx"></script>
<script type="text/dumbact-tsx"></script>
<script type="text/dumbact"></script>
```

`text/dumbact` uses TSX mode.

The compiler is a scanner, not TypeScript or Babel. It is for examples, small pages, local tools, and direct browser prototypes. Supported code must be ordinary browser JavaScript after type annotations are removed and JSX is lowered to `Dumbact.h(...)`.

## Module graph support

Use real `import` and `export` with module script types.

```html
<script src="./dumbact.js"></script>
<script type="text/dumbact-tsx-module" src="./app.tsx"></script>
```

`app.tsx`:

```tsx
import { render } from "dumbact";
import { App } from "./view.tsx";

render(App, "#app");
```

`view.tsx`:

```tsx
import { get, set } from "dumbact";

export function App() {
  return <button onClick={() => set("count", n => (n || 0) + 1)}>
    Count: {get("count", 0)}
  </button>;
}
```

Supported module script types:

```html
<script type="text/dumbact-js-module" src="./app.js"></script>
<script type="text/dumbact-ts-module" src="./app.ts"></script>
<script type="text/dumbact-jsx-module" src="./app.jsx"></script>
<script type="text/dumbact-tsx-module" src="./app.tsx"></script>
<script type="text/dumbact-module" src="./app.tsx"></script>
```

Allowed module imports are relative paths, absolute paths, full URLs, and the built-in `dumbact` specifier. Explicit full `http:` and `https:` JavaScript module URLs are left as native browser imports. Relative/local JS, TS, JSX, and TSX files are fetched, compiled when needed, and rewritten to generated module URLs.

Bare package imports are rejected except `dumbact`. Use a full browser CDN URL, a local server route, or an import map if the browser should load a package. This keeps browser code explicit and avoids pretending that npm packages are browser modules without a server, CDN, import map, or bundler decision.

Run module examples from a local HTTP server, not `file://`, because browsers restrict module and fetch behavior on local files.

```sh
npm run serve
```

Then open:

```txt
http://127.0.0.1:3000/demos/11-module-graph-tsx.html
http://127.0.0.1:3000/demos/13-cdn-module-tsx.html
```

## Demos

| file | subject |
|---|---|
| `minimal-counter.html` | Complete minimal page |
| `demos/01-state-ids-counter-tsx.html` | TSX state cell counter |
| `demos/02-local-todo-jsx.html` | JSX localStorage todo list |
| `demos/03-no-prop-drilling-ts.html` | Type-stripped TS with `h()` |
| `demos/04-keyed-list-benchmark-js.html` | Keyed list operations |
| `demos/05-form-validation-tsx.html` | Form validation |
| `demos/06-svg-dashboard-jsx.html` | SVG dashboard |
| `demos/07-api-notes-paired.html` | Express REST notes |
| `demos/08-sse-metrics-paired.html` | Express SSE metrics |
| `demos/09-vote-wall-singlefile.server.mjs` | Single-file Express app |
| `demos/10-command-palette-singlefile.server.mjs` | Single-file Express search with Lodash npm import |
| `demos/11-module-graph-tsx.html` | Multi-file TS/TSX module graph |
| `demos/12-cdn-html-libs.html` | Bootstrap CSS CDN, Lodash script CDN, static local CSS |
| `demos/13-cdn-module-tsx.html` | TS/TSX module graph with Lodash ES CDN module import |
| `demos/14-multifile-jsx/` | Multi-file JSX grocery basket client and server folder |
| `demos/15-multifile-tsx/` | Multi-file TSX service queue client and server folder |

## Commands

Install dependencies without a lockfile:

```sh
npm install --package-lock=false --no-audit --no-fund
```

Run all checks:

```sh
npm test
```

Run parts separately:

```sh
npm run test:runtime
npm run test:demo
npm run test:browser
npm run test:fuzzbench
npm run test:fuzz
npm run test:bench
```

`npm test` uses `tests/fuzz-bench.mjs` for one shared Chromium fuzz and benchmark pass. `test:fuzz` and `test:bench` remain available as separate development checks.

Run demos:

```sh
npm run serve
npm run serve:notes
npm run serve:sse
npm run serve:votes
npm run serve:palette
npm run serve:grocery
npm run serve:queue
```

`test:browser`, `test:fuzz`, and `test:bench` use Chromium through `playwright-core`. Set `CHROMIUM_PATH=/path/to/chromium` if Chromium is not on the system path.

## What is tested

`dumbact.test.js` checks the core with a deterministic DOM model.

`tests/demo-smoke.mjs` compiles and executes the single-file HTML demos, checks module demo source files, checks static CSS requirements, verifies removed APIs are absent, verifies CDN/library examples are present, verifies the Lodash npm import in the `.mjs` server demo, and checks real Express endpoints for REST, SSE, vote, palette, grocery, and queue data.

`tests/browser-smoke.mjs` opens the minimal example, demos 01-08, demo 12, module demos 11 and 13, and the server/client folder demos 14 and 15 in Chromium. It checks real user interactions, REST, SSE, module imports, CDN compatibility through deterministic CDN route shims, ready markers, system errors, and horizontal overflow. The heavier single-file servers 09 and 10 are covered through real Express endpoint checks in `tests/demo-smoke.mjs`.

`tests/fuzz-bench.mjs` runs random keyed-list edits, event-handler replacement, mount/unmount cycles, and the benchmark in one Chromium session during `npm test`.

`tests/fuzz.mjs` and `tests/bench.mjs` remain available as separate Chromium checks for development.

See `TESTED.md` and `BENCHMARK.md` for the latest local results.
