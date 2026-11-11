# Deliberately left untouched

- No handler, store shape, atom, prompt, data file, scoring rule or chat/memory logic was changed. `Ctx` is identical.
- Not implemented because the host types are not available here (rule: do not use a prop that is not in the types): `hover` borders, `alignSelf` for a stretching status rail, `justifyContent="space-between"`, italic.
- The status rail is a glyph column, not a filled Box. The custom template steps use indentation instead of a vertical line.
- Narrow tier: decorative tints are not hidden separately. Every tint shown carries data, so none was dropped; blocks wrap instead.
- The root `register.tsx` is a leftover that `hooks/hooks.json` does not load. It was not touched.
