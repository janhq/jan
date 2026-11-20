import { describe, it, expect, vi } from 'vitest'
import { useAssistant, defaultAssistant } from '../useAssistant'

const createAssistant = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({ assistants: () => ({ createAssistant }) }),
  useServiceHub: () => ({ assistants: () => ({ createAssistant }) }),
}))

describe('useAssistant.updateAssistant persistence', () => {
  it('leaves the store untouched when the write fails', async () => {
    createAssistant.mockRejectedValueOnce(new Error('disk full'))
    useAssistant.setState({
      assistants: [defaultAssistant],
      currentAssistant: defaultAssistant,
    })
    await expect(
      useAssistant.getState().updateAssistant({ ...defaultAssistant, name: 'X' })
    ).rejects.toThrow('disk full')
    expect(useAssistant.getState().assistants[0].name).toBe(defaultAssistant.name)
    expect(useAssistant.getState().currentAssistant?.name).toBe(
      defaultAssistant.name
    )
  })

  it('applies the update after the write succeeds', async () => {
    createAssistant.mockResolvedValueOnce(undefined)
    useAssistant.setState({
      assistants: [defaultAssistant],
      currentAssistant: defaultAssistant,
    })
    await useAssistant
      .getState()
      .updateAssistant({ ...defaultAssistant, name: 'Y' })
    expect(useAssistant.getState().assistants[0].name).toBe('Y')
    expect(useAssistant.getState().currentAssistant?.name).toBe('Y')
  })
})
