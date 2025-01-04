// ExtensionManager.test.ts
import { AIEngine, BaseExtension, ExtensionTypeEnum } from '@janhq/core'
import { ExtensionManager } from './ExtensionManager'
import Extension from './Extension'

class TestExtension extends BaseExtension {
  onLoad(): void {}
  onUnload(): void {}
}
class TestEngine extends AIEngine {
  provider: string = 'testEngine'
  onUnload(): void {}
}

describe('ExtensionManager', () => {
  let manager: ExtensionManager

  beforeEach(() => {
    manager = new ExtensionManager()
  })

  it('should register an extension', () => {
    const extension = new TestExtension('', '')
    manager.register('testExtension', extension)
    expect(manager.getByName('testExtension')).toBe(extension)
  })

  it('should register an AI engine', () => {
    const extension = { provider: 'testEngine' } as unknown as BaseExtension
    manager.register('testExtension', extension)
    expect(manager.getEngine('testEngine')).toBe(extension)
  })

  it('should retrieve an extension by type', () => {
    const extension = new TestExtension('', '')
    jest.spyOn(extension, 'type').mockReturnValue(ExtensionTypeEnum.Assistant)
    manager.register('testExtension', extension)
    expect(manager.get(ExtensionTypeEnum.Assistant)).toBe(extension)
  })

  it('should retrieve an extension by name', () => {
    const extension = new TestExtension('', '')
    manager.register('testExtension', extension)
    expect(manager.getByName('testExtension')).toBe(extension)
  })

  it('should retrieve all extensions', () => {
    const extension1 = new TestExtension('', '')
    const extension2 = new TestExtension('', '')
    manager.register('testExtension1', extension1)
    manager.register('testExtension2', extension2)
    expect(manager.getAll()).toEqual([extension1, extension2])
  })

  it('should retrieve an engine by name', () => {
    const engine = new TestEngine('', '')
    manager.register('anything', engine)
    expect(manager.getEngine('testEngine')).toBe(engine)
  })

  it('should load all extensions', () => {
    const extension = new TestExtension('', '')
    jest.spyOn(extension, 'onLoad')
    manager.register('testExtension', extension)
    manager.load()
    expect(extension.onLoad).toHaveBeenCalled()
  })

  it('should unload all extensions', () => {
    const extension = new TestExtension('', '')
    jest.spyOn(extension, 'onUnload')
    manager.register('testExtension', extension)
    manager.unload()
    expect(extension.onUnload).toHaveBeenCalled()
  })

  it('should list all extensions', () => {
    const extension1 = new TestExtension('', '')
    const extension2 = new TestExtension('', '')
    manager.register('testExtension1', extension1)
    manager.register('testExtension2', extension2)
    expect(manager.listExtensions()).toEqual([extension1, extension2])
  })

  it('should retrieve active extensions', async () => {
    const extension = new Extension(
      'url',
      'name',
      'productName',
      true,
      'description',
      'version'
    )
    window.core = {
      api: {
        getActiveExtensions: jest.fn(),
      },
    }
    jest
      .spyOn(window.core.api, 'getActiveExtensions')
      .mockResolvedValue([extension])
    const activeExtensions = await manager.getActive()
    expect(activeExtensions.length).toBeGreaterThan(0)
  })

  it('should register all active extensions', async () => {
    const extension = new Extension(
      'url',
      'name',
      'productName',
      true,
      'description',
      'version'
    )
    jest.spyOn(manager, 'getActive').mockResolvedValue([extension])
    jest.spyOn(manager, 'activateExtension').mockResolvedValue()
    await manager.registerActive()
    expect(manager.activateExtension).toHaveBeenCalledWith(extension)
  })

  it('should uninstall extensions', async () => {
    window.core = {
      api: {
        uninstallExtension: jest.fn(),
      },
    }
    jest.spyOn(window.core.api, 'uninstallExtension').mockResolvedValue(true)
    const result = await manager.uninstall(['testExtension'])
    expect(result).toBe(true)
  })
})
