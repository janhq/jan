// Preserve the original rejection (even undefined) and attempt every cleanup.
// A lone work failure is rethrown unchanged; combined failures retain it first
// in errors and as cause, followed by each cleanup failure in execution order.
export async function withCleanup<T>(work: () => Promise<T>,
  cleanups: () => Iterable<() => unknown | Promise<unknown>>, message: string): Promise<T> {
  let failed = false
  let original: unknown
  let result!: T
  try { result = await work() } catch (error) { failed = true; original = error }
  const failures: unknown[] = []
  for (const cleanup of cleanups()) {
    try { await cleanup() } catch (error) { failures.push(error) }
  }
  if (failures.length) {
    throw new AggregateError(failed ? [original, ...failures] : failures, message,
      failed ? { cause: original } : undefined)
  }
  if (failed) throw original
  return result
}

// The runner uses the same deadline path as tests, with a short duration in
// tests. dispose must be called during teardown to avoid a stale phase timer.
export function deadlineCancellation(ms: number, error: Error, onCancel: () => void = () => {}) {
  let reject!: (error: Error) => void
  let cancelled = false
  const promise = new Promise<never>((_, fail) => { reject = fail })
  const cancel = (reason: Error) => {
    if (cancelled) return
    cancelled = true
    onCancel()
    reject(reason)
  }
  const timer = setTimeout(() => cancel(error), ms)
  return { promise, cancel, dispose: () => clearTimeout(timer) }
}
