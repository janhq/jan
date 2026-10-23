// The entry bundled into the prelude IIFE (build-prelude.mjs). It must run
// first in the composed worker script; see compose.ts.
import { installRuntime } from './runtime.js'

installRuntime(globalThis)
