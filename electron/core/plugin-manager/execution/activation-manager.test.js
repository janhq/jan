import { setup } from './index'
import { register, trigger, remove, clear, get } from "./activation-manager";
import { add } from './extension-manager'

let mockPlugins = {}
setup({
  importer(plugin) { return mockPlugins[plugin] }
})

afterEach(() => {
  clear()
  mockPlugins = {}
})

describe('register', () => {
  it('should add a new activation point to the register when a new, valid plugin is registered',
    () => {
      register({
        name: 'test',
        url: 'testPkg',
        activationPoints: ['ap1', 'ap2'],
        active: true
      })

      expect(get()).toEqual([
        {
          plugin: 'test',
          url: 'testPkg',
          activationPoint: 'ap1',
          activated: false
        },
        {
          plugin: 'test',
          url: 'testPkg',
          activationPoint: 'ap2',
          activated: false
        }
      ])
    }
  )

  it('should not add an activation point to the register when an existing, valid plugin is registered',
    () => {
      register({
        name: 'test',
        url: 'testPkg',
        activationPoints: ['ap1', 'ap2'],
        active: true
      })

      register({
        name: 'test',
        url: 'testPkg',
        activationPoints: ['ap2', 'ap3'],
        active: true
      })

      expect(get()).toEqual([
        {
          plugin: 'test',
          url: 'testPkg',
          activationPoint: 'ap1',
          activated: false
        },
        {
          plugin: 'test',
          url: 'testPkg',
          activationPoint: 'ap2',
          activated: false
        },
        {
          plugin: 'test',
          url: 'testPkg',
          activationPoint: 'ap3',
          activated: false
        },
      ])
    }
  )

  it('should throw an error when an invalid plugin is registered',
    () => {
      const noActivationPoints = () => register({
        name: 'test',
        url: 'testPkg',
        active: true
      })

      expect(noActivationPoints).toThrow(/does not have any activation points set up in its manifest/)
    }
  )
})

describe('trigger', () => {
  it('should trigger all and only the activations with for the given execution point on triggering an execution, using the defined importer',
    async () => {
      const triggered = []

      mockPlugins.plugin1 = {
        ap1() { triggered.push('plugin1-ap1') }
      }
      mockPlugins.plugin2 = {
        ap2() { triggered.push('plugin2-ap2') }
      }
      mockPlugins.plugin3 = {
        ap1() { triggered.push('plugin3-ap1') },
        ap2() { triggered.push('plugin3-ap2') }
      }

      register({
        name: 'plugin1',
        url: 'plugin1',
        activationPoints: ['ap1'],
        active: true
      })
      register({
        name: 'plugin2',
        url: 'plugin2',
        activationPoints: ['ap2'],
        active: true
      })
      register({
        name: 'plugin3',
        url: 'plugin3',
        activationPoints: ['ap1', 'ap2'],
        active: true
      })

      await trigger('ap1')

      expect(triggered).toEqual(['plugin1-ap1', 'plugin3-ap1'])
    }
  )

  it('should return an error if an activation point is triggered on a plugin that does not include it',
    async () => {
      mockPlugins.plugin1 = {
        wrongAp() { }
      }

      register({
        name: 'plugin1',
        url: 'plugin1',
        activationPoints: ['ap1']
      })

      await expect(() => trigger('ap1')).rejects.toThrow(/was triggered but does not exist on plugin/)
    }
  )

  it('should provide the registered extension points to the triggered activation point if presetEPs is set to true in the setup',
    async () => {
      setup({
        importer(plugin) { return mockPlugins[plugin] },
        presetEPs: true,
      })

      let ap1Res

      mockPlugins.plugin1 = {
        ap1: eps => ap1Res = eps
      }
      register({
        name: 'plugin1',
        url: 'plugin1',
        activationPoints: ['ap1']
      })

      add('ep1')
      add('ep2')

      await trigger('ap1')

      expect(ap1Res.ep1.constructor.name).toEqual('ExtensionPoint')
      expect(ap1Res.ep2.constructor.name).toEqual('ExtensionPoint')
    }
  )

  it('should allow registration, execution and serial execution of execution points when an activation point is triggered if presetEPs is set to false in the setup',
    async () => {
      setup({
        importer(plugin) { return mockPlugins[plugin] },
      })

      let ap1Res

      mockPlugins.plugin1 = {
        ap1: eps => ap1Res = eps
      }
      register({
        name: 'plugin1',
        url: 'plugin1',
        activationPoints: ['ap1']
      })

      await trigger('ap1')

      expect(typeof ap1Res.register).toBe('function')
      expect(typeof ap1Res.execute).toBe('function')
      expect(typeof ap1Res.executeSerial).toBe('function')
    }
  )

  it('should not provide any reference to extension points during activation point triggering if presetEPs is set to null in the setup',
    async () => {
      setup({
        importer(plugin) { return mockPlugins[plugin] },
        presetEPs: null,
      })

      let ap1Res = true

      mockPlugins.plugin1 = {
        ap1: eps => ap1Res = eps
      }
      register({
        name: 'plugin1',
        url: 'plugin1',
        activationPoints: ['ap1']
      })

      await trigger('ap1')

      expect(ap1Res).not.toBeDefined()
    }
  )
})

describe('remove and clear', () => {

  beforeEach(() => {
    register({
      name: 'plugin1',
      url: 'plugin1',
      activationPoints: ['ap1', 'ap2'],
      active: true
    })

    register({
      name: 'plugin2',
      url: 'plugin2',
      activationPoints: ['ap2', 'ap3'],
      active: true
    })
  })
  it('should remove all and only the activations for the given plugin from the register when removing activations',
    () => {
      remove('plugin1')

      expect(get()).toEqual([
        {
          plugin: 'plugin2',
          url: 'plugin2',
          activationPoint: 'ap2',
          activated: false
        },
        {
          plugin: 'plugin2',
          url: 'plugin2',
          activationPoint: 'ap3',
          activated: false
        },
      ])
    }
  )

  it('should not remove any activations from the register if no plugin name is provided',
    () => {
      remove()

      expect(get()).toEqual([
        {
          plugin: 'plugin1',
          url: 'plugin1',
          activationPoint: 'ap1',
          activated: false
        },
        {
          plugin: 'plugin1',
          url: 'plugin1',
          activationPoint: 'ap2',
          activated: false
        },
        {
          plugin: 'plugin2',
          url: 'plugin2',
          activationPoint: 'ap2',
          activated: false
        },
        {
          plugin: 'plugin2',
          url: 'plugin2',
          activationPoint: 'ap3',
          activated: false
        },
      ])
    }
  )

  it('should remove all activations from the register when clearing the register',
    () => {
      clear()

      expect(get()).toEqual([])
    }
  )
})
