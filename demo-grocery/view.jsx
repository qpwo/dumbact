/** JSX views for the multi-file grocery basket server/client demo. */
import {
  addItem,
  boughtCount,
  draft,
  filter,
  remaining,
  setDraft,
  setFilter,
  status,
  toggleItem,
  total,
  visibleItems
} from './state.js'

function Money(props) {
  return <strong>
    {'$'}
    {props.value.toFixed(2)}
  </strong>
}

function FilterButton(props) {
  return <button class={filter() === props.value ? 'on' : ''} onClick={() => setFilter(props.value)}>
    {props.label}
  </button>
}

function BasketForm() {
  return <form class='rw' onSubmit={addItem}>
    <input
      data-testid='grocery-input'
      value={draft()}
      onInput={event => setDraft(event.target.value)}
      placeholder='Add bananas, rice, soap...'
      aria-label='new grocery item'
    />
    <button data-testid='grocery-add'>Add item</button>
  </form>
}

function BasketList() {
  const rows = visibleItems()
  return <ul class='ls' data-testid='grocery-list'>
    {rows.map(item => <li class='it' key={item.id}>
      <span class={item.done ? 'done' : ''}>
        {item.name} <span class='mut'>/ {item.aisle}</span>
      </span>
      <button data-testid={'grocery-toggle-' + item.id} onClick={() => toggleItem(item.id)}>
        {item.done ? 'Put back' : 'Got it'}
      </button>
    </li>)}
  </ul>
}

export function GroceryApp() {
  return <section class='gd' data-ready='grocery-jsx'>
    <article class='c stk'>
      <div class='sp'>
        <div>
          <h2>Basket</h2>
          <p class='mut'>Checked items stay in the server list so the trip remains auditable.</p>
        </div>
        <div class='big' data-testid='grocery-left'>
          {visibleItems().length}
        </div>
      </div>
      <BasketForm />
      <div class='rw'>
        <FilterButton value='all' label='all' />
        <FilterButton value='needed' label='needed' />
        <FilterButton value='done' label='done' />
      </div>
    </article>
    <aside class='c stk'>
      <h2>Trip cost</h2>
      <p>
        Total estimate: <Money value={total()} />
      </p>
      <p>
        Still needed:{' '}
        <span data-testid='grocery-remaining'>
          <Money value={remaining()} />
        </span>
      </p>
      <p class='mut'>
        {boughtCount()} already checked off. Server status: <span data-testid='grocery-status'>{status()}</span>.
      </p>
    </aside>
    <article class='c wide stk'>
      <h2>Items</h2>
      <BasketList />
    </article>
  </section>
}
