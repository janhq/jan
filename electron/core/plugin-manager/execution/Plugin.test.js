import { setImporter } from "./import-manager"
import Plugin from './Plugin'

describe('triggerExport', () => {
  it('should call the provided export on the plugin\'s main file', async () => {
    // Set up mock importer with mock main plugin file
    const mockExport = jest.fn()
    const mockImporter = jest.fn(() => ({
      lifeCycleFn: mockExport
    }))
    setImporter(mockImporter)

    // Call triggerExport on new plugin
    const plgUrl = 'main'
    const plugin = new Plugin('test', plgUrl, ['ap1'], true)
    await plugin.triggerExport('lifeCycleFn')

    // Check results
    expect(mockImporter.mock.lastCall).toEqual([plgUrl])
    expect(mockExport.mock.calls.length).toBeTruthy()
  })
})