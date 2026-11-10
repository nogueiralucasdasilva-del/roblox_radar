// Loose stub of the host module, only so the mod sources can be typechecked outside the app.
declare module 'claude-code' {
  export const atom: any
  export const read: any
  export const update: any
  export type Register = (on: any) => void
}
declare module 'claude-code/testing' {
  export const expect: any
  export const mock: any
  export const test: any
}
declare namespace JSX {
  interface IntrinsicElements { [name: string]: any }
  type Element = any
}
