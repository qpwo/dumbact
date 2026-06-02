import { scope } from 'dumbact'

type ModuleState = { label: string }

export const S = scope('module-demo')

if (!S.peek('count')) S.set('count', 0)
S.set('info', { label: 'native import/export' } as ModuleState)

export function count(): number {
  return S.get('count', 0)
}

export function info(): ModuleState {
  return S.get('info', { label: 'module' })
}

export function inc(): void {
  S.set('count', (n: number) => (n || 0) + 1)
}
