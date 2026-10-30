// The entry bundled into the prelude IIFE (build-prelude.mjs). It must run
// first in the composed worker script; see compose.ts. The imports run in
// order: start.ts checks the realm (realm.ts, before any other module of
// the prelude reads a global) and strips the worker; lockdown.ts then
// evaluates SES. The prelude ends by locking the realm down, so the
// bundle that follows it starts in a frozen realm.
import { runtime } from './start.js'
import { lockdownWorker } from './lockdown.js'

runtime.seal(lockdownWorker())
