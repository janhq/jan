jest.mock('electron', () => {
  const handlers = {}

  return {
    ipcMain: {
      handle(channel, callback) {
        handlers[channel] = callback
      }
    },
    ipcRenderer: {
      invoke(channel, ...args) {
        return Promise.resolve(handlers[channel].call(undefined, 'event', ...args))
      }
    },
    webContents: {
      getAllWebContents: jest.fn(() => [])
    },
    contextBridge: {
      exposeInMainWorld(key, val) {
        global.window = { [key]: val }
      }
    }
  }
})

jest.mock('../pluginMgr/store', () => {
  const setActive = jest.fn(() => true)
  const uninstall = jest.fn()
  const update = jest.fn(() => true)
  const isUpdateAvailable = jest.fn(() => false)

  class Plugin {
    constructor(name) {
      this.name = name
      this.activationPoints = ['test']
    }
    setActive = setActive
    uninstall = uninstall
    update = update
    isUpdateAvailable = isUpdateAvailable
  }

  return {
    getPlugin: jest.fn(name => new Plugin(name)),
    getActivePlugins: jest.fn(() => [new Plugin('test')]),
    installPlugins: jest.fn(async plugins => plugins.map(name => new Plugin(name))),
    removePlugin: jest.fn()
  }
})

const { rmSync } = require('fs')
const { webContents } = require('electron')
const useFacade = require('./index')
const { getActive, install, toggleActive, uninstall, update, updatesAvailable, registerActive } = require('../execution/facade')
const { setPluginsPath, setConfirmInstall } = require('../pluginMgr/globals')
const router = require('../pluginMgr/router')
const { getPlugin, getActivePlugins, removePlugin } = require('../pluginMgr/store')
const { get: getActivations } = require('../execution/activation-manager')

const pluginsPath = './testPlugins'
const confirmInstall = jest.fn(() => true)

beforeAll(async () => {
  setPluginsPath(pluginsPath)
  router()
  useFacade()
})

afterAll(() => {
  rmSync(pluginsPath, { recursive: true })
})

describe('install', () => {
  it('should return cancelled state if the confirmPlugin callback returns falsy', async () => {
    setConfirmInstall(() => false)
    const plugins = await install(['test-install'])
    expect(plugins).toEqual(false)
  })

  it('should perform a security check of the install using confirmInstall if facade is used', async () => {
    setConfirmInstall(confirmInstall)
    await install(['test-install'])
    expect(confirmInstall.mock.calls.length).toBeTruthy()
  })

  it('should register all installed plugins', async () => {
    const pluginName = 'test-install'
    await install([pluginName])
    expect(getActivations()).toContainEqual(expect.objectContaining({
      plugin: pluginName
    }))
  })

  it('should return a list of plugins', async () => {
    setConfirmInstall(confirmInstall)
    const pluginName = 'test-install'
    const plugins = await install([pluginName])
    expect(plugins).toEqual([expect.objectContaining({ name: pluginName })])
  })
})

describe('uninstall', () => {
  it('should uninstall all plugins with the provided name, remove it from the store and refresh all renderers', async () => {
    // Reset mock functions
    const mockUninstall = getPlugin().uninstall
    mockUninstall.mockClear()
    removePlugin.mockClear()
    webContents.getAllWebContents.mockClear()
    getPlugin.mockClear()

    // Uninstall plugins
    const specs = ['test-uninstall-1', 'test-uninstall-2']
    await uninstall(specs)

    // Test result
    expect(getPlugin.mock.calls).toEqual(specs.map(spec => [spec]))
    expect(mockUninstall.mock.calls.length).toBeTruthy()
    expect(removePlugin.mock.calls.length).toBeTruthy()
    expect(webContents.getAllWebContents.mock.calls.length).toBeTruthy()
  })
})

describe('getActive', () => {
  it('should return all active plugins', async () => {
    getActivePlugins.mockClear()
    await getActive()
    expect(getActivePlugins.mock.calls.length).toBeTruthy()
  })
})

describe('registerActive', () => {
  it('should register all active plugins', async () => {
    await registerActive()
    expect(getActivations()).toContainEqual(expect.objectContaining({
      plugin: 'test'
    }))
  })
})

describe('update', () => {
  const specs = ['test-uninstall-1', 'test-uninstall-2']
  const mockUpdate = getPlugin().update

  beforeAll(async () => {
    // Reset mock functions
    mockUpdate.mockClear()
    webContents.getAllWebContents.mockClear()
    getPlugin.mockClear()

    // Update plugins
    await update(specs)
  })

  it('should call the update function on all provided plugins', async () => {
    // Check result
    expect(getPlugin.mock.calls).toEqual(specs.map(spec => [spec]))
    expect(mockUpdate.mock.calls.length).toBe(2)
  })

  it('should reload the renderers if reload is true', () => {
    expect(webContents.getAllWebContents.mock.calls.length).toBeTruthy()
  })

  it('should not reload the renderer if reload is false', async () => {
    webContents.getAllWebContents.mockClear()
    await update(['test-uninstall'], false)
    expect(webContents.getAllWebContents.mock.calls.length).toBeFalsy()
  })
})

describe('toggleActive', () => {
  it('call the setActive function on the plugin with the provided name, with the provided active state', async () => {
    await toggleActive('test-toggleActive', true)
    expect(getPlugin.mock.lastCall).toEqual(['test-toggleActive'])
    const mockSetActive = getPlugin().setActive
    expect(mockSetActive.mock.lastCall).toEqual([true])
  })
})

describe('updatesAvailable', () => {
  it('should return the new versions for the provided plugins if provided', async () => {
    // Reset mock functions
    const mockIsUpdAvailable = getPlugin().isUpdateAvailable
    mockIsUpdAvailable.mockClear()
    getPlugin.mockClear()

    // Get available updates
    const testPlugin1 = 'test-plugin-1'
    const testPlugin2 = 'test-update-2'
    const updates = await updatesAvailable([testPlugin1, testPlugin2])
    expect(updates).toEqual({
      [testPlugin1]: false,
      [testPlugin2]: false,
    })
  })
})
