// Minimal typings for the node builtins used by layoutContract.test.ts.
// tsconfig.app deliberately omits @types/node so node globals stay out of app
// code's type space; these ambient declarations type exactly the three
// functions the contract test needs and nothing else. Vitest resolves the
// real builtins at runtime.
declare module 'node:fs' {
  export function readdirSync(path: string, options: { recursive: true }): string[]
  export function readFileSync(path: string, encoding: 'utf8'): string
}

declare module 'node:path' {
  export function join(...parts: string[]): string
  export function dirname(p: string): string
}

declare module 'node:url' {
  export function fileURLToPath(url: string): string
}
