import { BaseExtension } from './extension'
import { SettingComponentProps } from '../types'
import { getJanDataFolderPath, joinPath } from './core'
import { fs } from './fs'
jest.mock('./core')
jest.mock('./fs')

class TestBaseExtension extends BaseExtension {
  onLoad(): void {}
  onUnload(): void {}
}

describe('BaseExtension', () => {
  let baseExtension: TestBaseExtension

  beforeEach(() => {
    baseExtension = new TestBaseExtension('https://example.com', 'TestExtension')
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('should have the correct properties', () => {
    expect(baseExtension.name).toBe('TestExtension')
    expect(baseExtension.productName).toBeUndefined()
    expect(baseExtension.url).toBe('https://example.com')
    expect(baseExtension.active).toBeUndefined()
    expect(baseExtension.description).toBeUndefined()
    expect(baseExtension.version).toBeUndefined()
  })

  it('should return undefined for type()', () => {
    expect(baseExtension.type()).toBeUndefined()
  })

  it('should have abstract methods onLoad() and onUnload()', () => {
    expect(baseExtension.onLoad).toBeDefined()
    expect(baseExtension.onUnload).toBeDefined()
  })

  it('should install the extension', async () => {
    await baseExtension.install()
    // Add your assertions here
  })
})

describe('BaseExtension', () => {
  class TestBaseExtension extends BaseExtension {
    onLoad(): void {}
    onUnload(): void {}
  }

  let baseExtension: TestBaseExtension

  beforeEach(() => {
    baseExtension = new TestBaseExtension('https://example.com', 'TestExtension')
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('should have the correct properties', () => {
    expect(baseExtension.name).toBe('TestExtension')
    expect(baseExtension.productName).toBeUndefined()
    expect(baseExtension.url).toBe('https://example.com')
    expect(baseExtension.active).toBeUndefined()
    expect(baseExtension.description).toBeUndefined()
    expect(baseExtension.version).toBeUndefined()
  })

  it('should return undefined for type()', () => {
    expect(baseExtension.type()).toBeUndefined()
  })

  it('should have abstract methods onLoad() and onUnload()', () => {
    expect(baseExtension.onLoad).toBeDefined()
    expect(baseExtension.onUnload).toBeDefined()
  })

  it('should install the extension', async () => {
    await baseExtension.install()
    // Add your assertions here
  })

  it('should register settings', async () => {
    const settings: SettingComponentProps[] = [
      { key: 'setting1', controllerProps: { value: 'value1' } } as any,
      { key: 'setting2', controllerProps: { value: 'value2' } } as any,
    ]

    ;(getJanDataFolderPath as jest.Mock).mockResolvedValue('/data')
    ;(joinPath as jest.Mock).mockResolvedValue('/data/settings/TestExtension')
    ;(fs.existsSync as jest.Mock).mockResolvedValue(false)
    ;(fs.mkdir as jest.Mock).mockResolvedValue(undefined)
    ;(fs.writeFileSync as jest.Mock).mockResolvedValue(undefined)

    await baseExtension.registerSettings(settings)

    expect(fs.mkdir).toHaveBeenCalledWith('/data/settings/TestExtension')
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      '/data/settings/TestExtension',
      JSON.stringify(settings, null, 2)
    )
  })

  it('should get setting with default value', async () => {
    const settings: SettingComponentProps[] = [
      { key: 'setting1', controllerProps: { value: 'value1' } } as any,
    ]

    jest.spyOn(baseExtension, 'getSettings').mockResolvedValue(settings)

    const value = await baseExtension.getSetting('setting1', 'defaultValue')
    expect(value).toBe('value1')

    const defaultValue = await baseExtension.getSetting('setting2', 'defaultValue')
    expect(defaultValue).toBe('defaultValue')
  })

  it('should update settings', async () => {
    const settings: SettingComponentProps[] = [
      { key: 'setting1', controllerProps: { value: 'value1' } } as any,
    ]

    jest.spyOn(baseExtension, 'getSettings').mockResolvedValue(settings)
    ;(getJanDataFolderPath as jest.Mock).mockResolvedValue('/data')
    ;(joinPath as jest.Mock).mockResolvedValue('/data/settings/TestExtension/settings.json')
    ;(fs.writeFileSync as jest.Mock).mockResolvedValue(undefined)

    await baseExtension.updateSettings([
      { key: 'setting1', controllerProps: { value: 'newValue' } } as any,
    ])

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      '/data/settings/TestExtension/settings.json',
      JSON.stringify([{ key: 'setting1', controllerProps: { value: 'newValue' } }], null, 2)
    )
  })
})
