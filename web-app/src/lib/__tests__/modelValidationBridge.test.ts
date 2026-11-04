import { describe, it, expect, vi } from 'vitest'

const emit = vi.hoisted(() => vi.fn())
vi.mock('@janhq/core', () => ({
  DownloadEvent: { onModelValidationStarted: 'onModelValidationStarted' },
  events: { emit },
}))

import { bridgeModelValidationStarted } from '../modelValidationBridge'

describe('bridgeModelValidationStarted', () => {
  it('relays the download manager event onto the core event bus', async () => {
    const unlisten = vi.fn()
    let relay: ((event: { payload: unknown }) => void) | undefined
    const listen = vi.fn(
      async (_name: string, handler: (event: { payload: unknown }) => void) => {
        relay = handler
        return unlisten
      }
    )

    const stop = await bridgeModelValidationStarted({ listen })

    // The name src-tauri/src/core/downloads/helpers.rs emits.
    expect(listen).toHaveBeenCalledWith(
      'onModelValidationStarted',
      expect.any(Function)
    )
    const payload = { modelId: 'qwen', downloadType: 'Model' }
    relay?.({ payload })
    expect(emit).toHaveBeenCalledWith('onModelValidationStarted', payload)
    expect(stop).toBe(unlisten)
  })
})
