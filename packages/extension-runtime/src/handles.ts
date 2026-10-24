import {
  Emitter,
  type CancellationToken,
  type Disposable,
  type Event,
} from '@janhq/extension-api'

/**
 * Numbered entries for things that cannot cross the boundary: functions on
 * the worker side, registrations on the host side. Ids start at 1 and are
 * never reused, so a stale id from a disposed entry can never hit a newer one.
 */
export class HandleTable<T> {
  private next = 1
  private readonly entries = new Map<number, T>()

  add(value: T): number {
    const id = this.next++
    this.entries.set(id, value)
    return id
  }

  get(id: number): T | undefined {
    return this.entries.get(id)
  }

  delete(id: number): T | undefined {
    const value = this.entries.get(id)
    this.entries.delete(id)
    return value
  }

  /** Empties the table and returns what it held, oldest first. */
  drain(): T[] {
    const values = [...this.entries.values()]
    this.entries.clear()
    return values
  }

  get size(): number {
    return this.entries.size
  }
}

/**
 * The host's registrations of one worker, addressed by the ids sent back to
 * it. `dispose(id)` serves `$dispose`; `disposeAll` runs when the worker
 * goes away, newest first like a `DisposableStore`.
 */
export class DisposableTable {
  private readonly table = new HandleTable<Disposable>()

  add(d: Disposable): number {
    return this.table.add(d)
  }

  /** False when `id` is unknown or already disposed. */
  dispose(id: number): boolean {
    const d = this.table.delete(id)
    d?.dispose()
    return d !== undefined
  }

  disposeAll(): void {
    for (const d of this.table.drain().reverse()) {
      try {
        d.dispose()
      } catch (error) {
        console.error('Disposing a worker registration failed:', error)
      }
    }
  }

  get size(): number {
    return this.table.size
  }
}

/** A token that never fires, for calls nobody can cancel. */
export const NONE_TOKEN: CancellationToken = Object.freeze({
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose: () => undefined }),
})

/** The writable side of a `CancellationToken`. */
export class CancellationTokenSource {
  private cancelled = false
  private readonly emitter = new Emitter<void>()

  readonly token: CancellationToken

  constructor() {
    const self = this
    const onCancellationRequested: Event<void> = (listener) => {
      // A listener added after cancellation still hears about it, so a
      // handler that subscribes late cannot miss the request.
      if (self.cancelled) {
        queueMicrotask(() => listener())
        return { dispose: () => undefined }
      }
      return self.emitter.event(listener)
    }
    this.token = {
      get isCancellationRequested() {
        return self.cancelled
      },
      onCancellationRequested,
    }
  }

  cancel(): void {
    if (this.cancelled) return
    this.cancelled = true
    this.emitter.fire()
    this.emitter.dispose()
  }
}
