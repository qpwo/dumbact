import { get, set } from 'dumbact'

type CdnRow = {
  id: string
  name: string
  kind: string
}

type Chunker = (rows: CdnRow[], size: number) => CdnRow[][]

type CdnAppProps = {
  chunk: Chunker
  rows: CdnRow[]
}

export function CdnApp(props: CdnAppProps) {
  const chunk = props.chunk
  const rows = props.rows
  const size = get('cdnmod:size', 3)
  const groups = chunk(rows, size)
  return <section class='gd' data-ready='cdn-module'>
    <article class='c stk'>
      <h2>External helper, local data</h2>
      <div class='big' data-testid='cdnmod-size'>
        {size}
      </div>
      <p>The external helper only chunks arrays. The app data remains plain objects.</p>
      <div class='rw'>
        <button aria-label='smaller chunks' onClick={() => set('cdnmod:size', (n: number) => Math.max(1, (n || 3) - 1))}>
          Smaller
        </button>
        <button aria-label='larger chunks' onClick={() => set('cdnmod:size', (n: number) => Math.min(5, (n || 3) + 1))}>
          Larger
        </button>
      </div>
    </article>
    <aside class='c stk'>
      <h2>Chunks</h2>
      <ul class='ls' data-testid='cdnmod-chunks'>
        {groups.map((group, i) => <li class='it' key={String(i)}>
          {group.map(x => x.name).join(' · ')}
        </li>)}
      </ul>
      <span class='bd' data-testid='cdnmod-count'>
        {groups.length} groups
      </span>
    </aside>
  </section>
}
