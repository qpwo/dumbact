import { count, inc, info } from "./state.ts";

export function App() {
  const n = count();
  const meta = info();
  return <section class="card stack" data-ready="11-module">
    <h2>{meta.label}</h2>
    <div class="metric" data-testid="module-count">{n}</div>
    <p>The button calls an exported function from <code>state.ts</code>. The view comes from <code>view.tsx</code>.</p>
    <div class="row"><button aria-label="module increase" onClick={inc}>Increase</button></div>
  </section>;
}
