// The entry bundled into the prelude IIFE (build-prelude.mjs). It must run
// first in the composed worker script; see compose.ts. `realm` is imported
// first so its checks run before any other module of the prelude reads a
// global.
import { realm } from './realm.js'
import { installRuntime } from './runtime.js'

installRuntime(realm)
