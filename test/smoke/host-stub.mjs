// Minimal stand-in for the host module "claude-code", only for the offline render smoke test.
export const state = (globalThis.__radarSmokeState ??= new Map())
export const atom = (key, init) => ({ ...key, init })
const k = a => `${a.plugin}:${a.key}`
export const read = async (_$, a) => (state.has(k(a)) ? state.get(k(a)) : a.init)
export const update = async (_$, a, fn) => {
  const cur = state.has(k(a)) ? state.get(k(a)) : a.init
  state.set(k(a), fn(cur))
}
