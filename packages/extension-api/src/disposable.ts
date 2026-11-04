/** Something that holds a resource or a registration until it is disposed. */
export interface Disposable {
  dispose(): void
}

/** Wraps a cleanup function; the function runs at most once. */
export function toDisposable(fn: () => void): Disposable {
  let disposed = false
  return {
    dispose() {
      if (disposed) return
      disposed = true
      fn()
    },
  }
}

/**
 * A set of disposables released together. Members are disposed in reverse
 * order of addition, so a registration made on top of an earlier one is torn
 * down first.
 *
 * The state lives in private fields, which stay writable when the store is
 * frozen: an extension worker hardens its `ctx`, `subscriptions` included.
 */
export class DisposableStore implements Disposable {
  #items: Disposable[] = []
  #disposed = false

  /**
   * Adds a member. Adding to a disposed store disposes the member at once, so
   * a registration that races with teardown cannot leak.
   */
  add<T extends Disposable>(d: T): T {
    if (this.#disposed) {
      d.dispose()
    } else {
      this.#items.push(d)
    }
    return d
  }

  /**
   * Disposes every member once. A throwing member does not stop the rest;
   * the first error is rethrown after all members ran.
   */
  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    const items = this.#items.reverse()
    this.#items = []
    let failure: { error: unknown } | undefined
    for (const item of items) {
      try {
        item.dispose()
      } catch (error) {
        failure ??= { error }
      }
    }
    if (failure) throw failure.error
  }
}
