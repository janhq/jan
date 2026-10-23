/**
 * Globals an extension worker must not reach: every network primitive, the
 * ways to load or spawn more code, origin-wide storage, and anything Tauri
 * might inject. Network goes through `ctx.http.fetch`, which the host checks
 * against the grants.
 */
export const STRIPPED_GLOBALS = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'WebTransport',
  'EventSource',
  'importScripts',
  'Worker',
  'SharedWorker',
  'BroadcastChannel',
  'indexedDB',
  'caches',
  '__TAURI__',
  '__TAURI_INTERNALS__',
  '__TAURI_IPC__',
] as const

/** Origin-wide storage and locks shared with the app window. */
export const STRIPPED_NAVIGATOR = ['storage', 'locks'] as const

/**
 * Replaces `name` with a non-configurable `undefined` on `target` and on
 * every prototype above it. Deleting first matters: an accessor left on a
 * prototype would still be reachable through `Object.getPrototypeOf`.
 * Object.prototype is left alone; nothing stripped lives there, and locking
 * names on it would change every object in the realm. Throws when a
 * property cannot be replaced, so the caller fails closed.
 */
function lockOut(target: object, name: string): void {
  for (
    let o: object | null = target;
    o !== null && o !== Object.prototype;
    o = Object.getPrototypeOf(o)
  ) {
    Reflect.deleteProperty(o, name)
    Object.defineProperty(o, name, {
      value: undefined,
      writable: false,
      enumerable: false,
      configurable: false,
    })
  }
}

/** Strips the globals above from `scope` and its `navigator`. */
export function stripGlobals(scope: object): void {
  // Read before stripping: `navigator` itself stays, only its storage goes.
  const navigator = (scope as { navigator?: object }).navigator
  for (const name of STRIPPED_GLOBALS) lockOut(scope, name)
  if (navigator)
    for (const name of STRIPPED_NAVIGATOR) lockOut(navigator, name)
}
