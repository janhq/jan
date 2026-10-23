import type { Transport } from './endpoint.js'

/**
 * The part of a DOM `Worker` the host uses. The sandbox harness implements
 * it too, which is what lets the host runtime be tested without a browser.
 */
export interface WorkerLike {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (e: { data: unknown }) => void): void
  addEventListener(type: 'error', listener: (e: { message: string }) => void): void
  removeEventListener(
    type: 'message',
    listener: (e: { data: unknown }) => void
  ): void
  removeEventListener(
    type: 'error',
    listener: (e: { message: string }) => void
  ): void
  terminate(): void
}

/** The host end of a worker channel; closing it terminates the worker. */
export function workerTransport(worker: WorkerLike): Transport {
  return {
    send: (message) => worker.postMessage(message),
    onMessage: (listener) => {
      const handler = (e: { data: unknown }) => listener(e.data)
      worker.addEventListener('message', handler)
      return { dispose: () => worker.removeEventListener('message', handler) }
    },
    close: () => worker.terminate(),
  }
}
