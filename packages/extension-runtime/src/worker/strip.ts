import type { Realm } from './realm.js'

/**
 * Globals an extension worker must not reach: every network primitive, the
 * ways to load or spawn more code, origin-wide storage, anything Tauri
 * might inject, and `Notification`, whose icon URL is fetched under the
 * wide img-src and so works as a beacon. Network goes through
 * `ctx.http.fetch`, which the host checks against the grants.
 *
 * Not stripped, and limited by the CSP instead: `import()` (script-src,
 * which still allows the posthog hosts) and `FontFace` (font-src).
 */
export const STRIPPED_GLOBALS = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'WebSocketStream',
  'WebTransport',
  'EventSource',
  'importScripts',
  'Worker',
  'SharedWorker',
  'BroadcastChannel',
  'Notification',
  'indexedDB',
  'caches',
  '__TAURI__',
  '__TAURI_INTERNALS__',
  '__TAURI_IPC__',
] as const

/** Origin-wide storage, locks and service workers shared with the app window. */
export const STRIPPED_NAVIGATOR = ['storage', 'locks', 'serviceWorker'] as const

/**
 * Replaces `name` with a non-configurable `undefined` on `target` and on
 * every prototype above it. Deleting first matters: an accessor left on a
 * prototype would still be reachable through `Object.getPrototypeOf`.
 * Object.prototype is left alone; nothing stripped lives there, and locking
 * names on it would change every object in the realm. Throws when a
 * property cannot be replaced, so the caller fails closed.
 */
function lockOut(realm: Realm, target: object, name: string): void {
  for (
    let o: object | null = target;
    o !== null && o !== realm.ObjectPrototype;
    o = realm.getPrototypeOf(o)
  ) {
    realm.deleteProperty(o, name)
    realm.defineProperty(o, name, {
      value: undefined,
      writable: false,
      enumerable: false,
      configurable: false,
    })
  }
}

/**
 * Every object a `navigator` getter on the scope's chain returns. The
 * getters are read off the descriptors, not through `scope.navigator`: a
 * bundle's `var navigator` or `function navigator() {}` shadows the name
 * with a decoy, while the getter still hands out the real one.
 */
function navigators(realm: Realm, scope: object): object[] {
  const found: object[] = []
  for (
    let o: object | null = scope;
    o !== null && o !== realm.ObjectPrototype;
    o = realm.getPrototypeOf(o)
  ) {
    const get = realm.getOwnPropertyDescriptor(o, 'navigator')?.get
    if (!get) continue
    const value = realm.apply(get, scope)
    if (typeof value === 'object' && value !== null) found.push(value)
  }
  return found
}

/**
 * Strips the globals above from `scope` and from its real `navigator`,
 * using only what `realm` captured before any extension code could run.
 */
export function stripGlobals(realm: Realm, scope: object): void {
  // Read before stripping: `navigator` itself stays, only its storage goes.
  // Every worker has one; none means a hoisted declaration replaced the
  // getter, and the real navigator may still be reachable some other way.
  const targets = navigators(realm, scope)
  if (targets.length === 0)
    throw realm.replaced('navigator')
  for (const name of STRIPPED_GLOBALS) lockOut(realm, scope, name)
  for (const navigator of targets)
    for (const name of STRIPPED_NAVIGATOR) lockOut(realm, navigator, name)
}
