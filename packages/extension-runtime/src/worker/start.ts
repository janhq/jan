// A module of its own so that module evaluation order does the sequencing:
// prelude.ts imports this before lockdown.ts, so the realm checks run and
// the worker is stripped before the SES module code reads, or calls, a
// single global. A bundle that slipped a hoisted `function WeakMap() {}`
// past the host's shape check would otherwise run inside SES's setup while
// `fetch` is still there.
import { realm } from './realm.js'
import { installRuntime } from './runtime.js'

export const runtime = installRuntime(realm)
