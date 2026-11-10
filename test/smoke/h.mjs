// JSX factory that builds plain objects, so the pane can be rendered and inspected without the app.
export function h(type, props, ...children) {
  return { type, props: props || {}, children: children.flat(Infinity).filter(c => c !== null && c !== undefined && c !== false) }
}
export const Fragment = 'Fragment'
