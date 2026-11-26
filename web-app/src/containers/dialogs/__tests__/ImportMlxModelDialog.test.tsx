import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { EngineManager, type AIEngine } from '@janhq/core'

const hoisted = vi.hoisted(() => ({
  dialogOpen: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('sonner', () => ({ toast: hoisted.toast }))
vi.mock('@/hooks/useServiceHub', () => {
  const hub = { dialog: () => ({ open: hoisted.dialogOpen }) }
  return { useServiceHub: () => hub, getServiceHub: () => hub }
})

import { ImportMlxModelDialog } from '../ImportMlxModelDialog'

const provider = { models: [] } as unknown as ModelProvider

async function importFolder() {
  render(
    <ImportMlxModelDialog provider={provider} trigger={<button>Open</button>} />
  )
  fireEvent.click(screen.getByText('Open'))
  hoisted.dialogOpen.mockResolvedValue('/models/my-mlx')
  fireEvent.click(await screen.findByText("Select Model Folder"))
  await screen.findByText('Change')
  fireEvent.click(screen.getByText('Import Model'))
}

describe('ImportMlxModelDialog', () => {
  beforeEach(() => vi.clearAllMocks())

  it('imports through the mlx engine the engine manager holds', async () => {
    const manager = new EngineManager()
    const engine = { provider: 'mlx', import: vi.fn().mockResolvedValue(undefined) }
    manager.register(engine as unknown as AIEngine)
    vi.spyOn(EngineManager, 'instance').mockReturnValue(manager)

    await importFolder()

    await waitFor(() =>
      expect(engine.import).toHaveBeenCalledWith('my-mlx', {
        modelPath: '/models/my-mlx',
      })
    )
    expect(hoisted.toast.success).toHaveBeenCalled()
  })

  it('reports an error when no mlx engine is registered', async () => {
    vi.spyOn(EngineManager, 'instance').mockReturnValue(new EngineManager())
    await importFolder()
    await waitFor(() => expect(hoisted.toast.error).toHaveBeenCalled())
  })
})
