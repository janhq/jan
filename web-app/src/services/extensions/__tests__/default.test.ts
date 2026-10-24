import { describe, expect, it } from 'vitest'
import { DefaultExtensionsService } from '../default'

describe('DefaultExtensionsService', () => {
  const service = new DefaultExtensionsService()

  it('reports no install pipeline', () => {
    expect(service.isSupported()).toBe(false)
  })

  it('lists nothing installed and no sources', async () => {
    await expect(service.list()).resolves.toEqual({
      safeMode: false,
      extensions: [],
    })
    await expect(service.listSources()).resolves.toEqual([])
  })

  it('refuses anything that would install or change state', async () => {
    const calls = [
      service.stageBundle(),
      service.stageFromIndex(),
      service.confirmInstall(),
      service.setEnabled(),
      service.setGrants(),
      service.uninstall(),
      service.rollback(),
      service.setSafeMode(),
      service.addSource(),
      service.removeSource(),
      service.getCatalog(),
    ]
    for (const call of calls) await expect(call).rejects.toThrow(/not supported/)
  })

  it('discards a stage without error, since none can exist', async () => {
    await expect(service.discardStage()).resolves.toBeUndefined()
  })
})
