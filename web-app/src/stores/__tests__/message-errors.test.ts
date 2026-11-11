import { describe, it, expect, beforeEach } from 'vitest'
import { useMessageErrors } from '../message-errors'

describe('useMessageErrors reports', () => {
  beforeEach(() => useMessageErrors.getState().clearAll())

  it('keeps a diagnostics report with its error until the error is cleared', () => {
    const s = useMessageErrors.getState()
    s.setError('m1', 'boom')
    s.setReport('m1', '## Model load failure', 'llama-3-8b')
    expect(useMessageErrors.getState().reports.m1).toEqual({
      text: '## Model load failure',
      model: 'llama-3-8b',
    })

    useMessageErrors.getState().clearError('m1')
    expect(useMessageErrors.getState().reports.m1).toBeUndefined()
  })

  // The model is what the check offered from the message runs on, so a report
  // recorded without one must not invent the current selection downstream.
  it('records no model when the failed turn was not a local one', () => {
    useMessageErrors.getState().setReport('m1', 'r')
    expect(useMessageErrors.getState().reports.m1.model).toBeUndefined()
  })

  it('drops reports when errors are hydrated from storage', () => {
    useMessageErrors.getState().setReport('m1', 'r')
    useMessageErrors.getState().hydrate({ m2: 'x' })
    expect(useMessageErrors.getState().reports).toEqual({})
  })
})
