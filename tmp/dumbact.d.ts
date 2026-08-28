/** Ambient editor types for Dumbact TS/TSX demos; no runtime output or build step. */
type DumbactStyleValue = string | number | null | undefined
type DumbactStyle = string | Partial<CSSStyleDeclaration> | Record<string, DumbactStyleValue>
type DumbactIntrinsicProps = {
  children?: unknown
  key?: string | number
  ref?: unknown
  class?: string
  className?: string
  style?: DumbactStyle
  [attribute: string]: unknown
}

declare namespace JSX {
  interface Element {}
  interface IntrinsicAttributes {
    key?: string | number
  }
  interface IntrinsicElements {
    [tagName: string]: DumbactIntrinsicProps
  }
}

declare module 'dumbact' {
  type DumbactPatch<T> = T | ((previous: T, id: string) => T)
  type DumbactListener<T> = (value: T, previous: T, id: string) => void

  export type Scope = {
    id(name: string): string
    get<T>(id: string, fallback: T): T
    get<T = unknown>(id: string): T
    peek<T>(id: string, fallback: T): T
    peek<T = unknown>(id: string): T
    need<T = unknown>(id: string): T
    has(id: string): boolean
    set<T>(id: string, patch: DumbactPatch<T>): T
    del(id: string): void
    clear(prefix?: string): void
    sub<T>(id: string, listener: DumbactListener<T>, immediate?: boolean): () => void
  }

  export const Fragment: symbol | string
  export function h(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): JSX.Element
  export const createElement: typeof h
  export const jsx: typeof h
  export const jsxs: typeof h
  export const jsxDEV: typeof h
  export function render(view: unknown, host: string | Element | DocumentFragment): () => void
  export const mount: typeof render
  export function unmount(host: string | Element | DocumentFragment): void
  export function flush(): void
  export function get<T>(id: string, fallback: T): T
  export function get<T = unknown>(id: string): T
  export function peek<T>(id: string, fallback: T): T
  export function peek<T = unknown>(id: string): T
  export function need<T = unknown>(id: string): T
  export function has(id: string): boolean
  export function set<T>(id: string, patch: DumbactPatch<T>): T
  export function del(id: string): void
  export function clear(prefix?: string): void
  export function sub<T>(id: string, listener: DumbactListener<T>, immediate?: boolean): () => void
  export function ids(prefix?: string): string[]
  export function snapshot(prefix?: string): Record<string, unknown>
  export function scope(prefix: string): Scope
  export function compile(source: string, mode?: string): string
  export function stripTypes(source: string): string
  export function transformJSX(source: string): string
  export function runScripts(root?: Document | Element): Promise<unknown[]>
  export function runScript(script: HTMLScriptElement): Promise<unknown>
  export const scriptTypes: Record<string, string>
  export function loadModule(url: string, mode?: string): Promise<string>
  export function moduleSourceURL(source: string, base: string, mode?: string, label?: string): Promise<string>
}

declare module 'https://cdn.jsdelivr.net/npm/lodash-es@4.17.21/chunk.js' {
  export default function chunk<T>(array: readonly T[], size?: number): T[][]
}
