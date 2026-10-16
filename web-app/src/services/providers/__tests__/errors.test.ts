import { describe, expect, it } from 'vitest'

import { getProviderRefreshErrorMessage } from '../errors'

describe('getProviderRefreshErrorMessage', () => {
  it('returns the structured provider error message when available', () => {
    const result = getProviderRefreshErrorMessage(
      new Error('Models endpoint not found for qianfan. Make sure the base URL includes the correct version path such as /v1 or /v2.'),
      'Failed to fetch models from qianfan.'
    )

    expect(result).toBe(
      'Models endpoint not found for qianfan. Make sure the base URL includes the correct version path such as /v1 or /v2.'
    )
  })

  it('falls back to the translated default message for non-Error values', () => {
    const result = getProviderRefreshErrorMessage(
      'plain string failure',
      'Failed to fetch models from qianfan.'
    )

    expect(result).toBe('Failed to fetch models from qianfan.')
  })
})
