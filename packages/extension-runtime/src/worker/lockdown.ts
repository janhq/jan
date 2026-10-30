// Evaluating 'ses' installs `lockdown` on the global; nothing else of it is
// used. The prelude bundles it, so a worker never fetches it.
import 'ses'

/**
 * How the worker realm is locked down.
 *
 * - `errorTaming: 'safe'` hides stacks from code that only holds an error,
 *   so they cannot leak host paths or be used to probe the runtime.
 * - `evalTaming: 'no-eval'` matches the CSP, which has no 'unsafe-eval':
 *   eval and Function throw even where a CSP is missing.
 * - `consoleTaming: 'unsafe'` keeps the worker's own console, so an
 *   extension's console output still reaches the devtools as is.
 */
const LOCKDOWN_OPTIONS = {
  errorTaming: 'safe',
  evalTaming: 'no-eval',
  consoleTaming: 'unsafe',
} as const

/** Freezes an object graph; what `lockdown` leaves as `harden`. */
export type Harden = <T>(value: T) => T

// Taken while the module evaluates, before any bundle code has run.
// `harden` cannot be taken the same way: SES only installs it when
// lockdown runs, which is still before the bundle, so reading it then is safe.
const lock = lockdown

/**
 * Freezes every primordial of the worker realm and returns `harden`. Runs
 * at the end of the prelude: after the realm checks, which need the
 * original `Error` that SES replaces, and before the bundle, so a bundle
 * (or one of its dependencies) can no longer change what the runtime and
 * other code in the worker rely on.
 */
export function lockdownWorker(): Harden {
  lock(LOCKDOWN_OPTIONS)
  return harden
}
