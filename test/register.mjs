// Lets node resolve the extensionless relative imports used by the mod sources, so the pure modules can be tested.
import { register } from 'node:module'
register('./loader.mjs', import.meta.url)
