import { EngineManagementExtension } from './enginesManagement'
import { ExtensionTypeEnum } from '../extension'
import {
  EngineConfig,
  EngineReleased,
  EngineVariant,
  Engines,
  InferenceEngine,
  DefaultEngineVariant,
  Model
} from '../../types'

// Mock implementation of EngineManagementExtension
class MockEngineManagementExtension extends EngineManagementExtension {
  private mockEngines: Engines = {
    llama: {
      name: 'llama',
      variants: [
        {
          variant: 'cpu',
          version: '1.0.0',
          path: '/engines/llama/cpu/1.0.0',
          installed: true
        },
        {
          variant: 'cuda',
          version: '1.0.0',
          path: '/engines/llama/cuda/1.0.0',
          installed: false
        }
      ],
      default: {
        variant: 'cpu',
        version: '1.0.0'
      }
    },
    gpt4all: {
      name: 'gpt4all',
      variants: [
        {
          variant: 'cpu',
          version: '2.0.0',
          path: '/engines/gpt4all/cpu/2.0.0',
          installed: true
        }
      ],
      default: {
        variant: 'cpu',
        version: '2.0.0'
      }
    }
  }

  private mockReleases: { [key: string]: EngineReleased[] } = {
    'llama-1.0.0': [
      {
        variant: 'cpu',
        version: '1.0.0',
        os: ['macos', 'linux', 'windows'],
        url: 'https://example.com/llama/1.0.0/cpu'
      },
      {
        variant: 'cuda',
        version: '1.0.0',
        os: ['linux', 'windows'],
        url: 'https://example.com/llama/1.0.0/cuda'
      }
    ],
    'llama-1.1.0': [
      {
        variant: 'cpu',
        version: '1.1.0',
        os: ['macos', 'linux', 'windows'],
        url: 'https://example.com/llama/1.1.0/cpu'
      },
      {
        variant: 'cuda',
        version: '1.1.0',
        os: ['linux', 'windows'],
        url: 'https://example.com/llama/1.1.0/cuda'
      }
    ],
    'gpt4all-2.0.0': [
      {
        variant: 'cpu',
        version: '2.0.0',
        os: ['macos', 'linux', 'windows'],
        url: 'https://example.com/gpt4all/2.0.0/cpu'
      }
    ]
  }

  private remoteModels: { [engine: string]: Model[] } = {
    'llama': [],
    'gpt4all': []
  }

  constructor() {
    super('http://mock-url.com', 'mock-engine-extension', 'Mock Engine Extension', true, 'A mock engine extension', '1.0.0')
  }

  onLoad(): void {
    // Mock implementation
  }

  onUnload(): void {
    // Mock implementation
  }

  async getEngines(): Promise<Engines> {
    return JSON.parse(JSON.stringify(this.mockEngines))
  }

  async getInstalledEngines(name: InferenceEngine): Promise<EngineVariant[]> {
    if (!this.mockEngines[name]) {
      return []
    }
    
    return this.mockEngines[name].variants.filter(variant => variant.installed)
  }

  async getReleasedEnginesByVersion(
    name: InferenceEngine,
    version: string,
    platform?: string
  ): Promise<EngineReleased[]> {
    const key = `${name}-${version}`
    let releases = this.mockReleases[key] || []
    
    if (platform) {
      releases = releases.filter(release => release.os.includes(platform))
    }
    
    return releases
  }

  async getLatestReleasedEngine(
    name: InferenceEngine,
    platform?: string
  ): Promise<EngineReleased[]> {
    // For mock, let's assume latest versions are 1.1.0 for llama and 2.0.0 for gpt4all
    const latestVersions = {
      'llama': '1.1.0',
      'gpt4all': '2.0.0'
    }
    
    if (!latestVersions[name]) {
      return []
    }
    
    return this.getReleasedEnginesByVersion(name, latestVersions[name], platform)
  }

  async installEngine(
    name: string,
    engineConfig: EngineConfig
  ): Promise<{ messages: string }> {
    if (!this.mockEngines[name]) {
      this.mockEngines[name] = {
        name,
        variants: [],
        default: {
          variant: engineConfig.variant,
          version: engineConfig.version
        }
      }
    }
    
    // Check if variant already exists
    const existingVariantIndex = this.mockEngines[name].variants.findIndex(
      v => v.variant === engineConfig.variant && v.version === engineConfig.version
    )
    
    if (existingVariantIndex >= 0) {
      this.mockEngines[name].variants[existingVariantIndex].installed = true
    } else {
      this.mockEngines[name].variants.push({
        variant: engineConfig.variant,
        version: engineConfig.version,
        path: `/engines/${name}/${engineConfig.variant}/${engineConfig.version}`,
        installed: true
      })
    }
    
    return { messages: `Successfully installed ${name} ${engineConfig.variant} ${engineConfig.version}` }
  }

  async addRemoteEngine(
    engineConfig: EngineConfig
  ): Promise<{ messages: string }> {
    const name = engineConfig.name || 'remote-engine'
    
    if (!this.mockEngines[name]) {
      this.mockEngines[name] = {
        name,
        variants: [],
        default: {
          variant: engineConfig.variant,
          version: engineConfig.version
        }
      }
    }
    
    this.mockEngines[name].variants.push({
      variant: engineConfig.variant,
      version: engineConfig.version,
      path: engineConfig.path || `/engines/${name}/${engineConfig.variant}/${engineConfig.version}`,
      installed: true,
      url: engineConfig.url
    })
    
    return { messages: `Successfully added remote engine ${name}` }
  }

  async uninstallEngine(
    name: InferenceEngine,
    engineConfig: EngineConfig
  ): Promise<{ messages: string }> {
    if (!this.mockEngines[name]) {
      return { messages: `Engine ${name} not found` }
    }
    
    const variantIndex = this.mockEngines[name].variants.findIndex(
      v => v.variant === engineConfig.variant && v.version === engineConfig.version
    )
    
    if (variantIndex >= 0) {
      this.mockEngines[name].variants[variantIndex].installed = false
      
      // If this was the default variant, reset default
      if (
        this.mockEngines[name].default.variant === engineConfig.variant &&
        this.mockEngines[name].default.version === engineConfig.version
      ) {
        // Find another installed variant to set as default
        const installedVariant = this.mockEngines[name].variants.find(v => v.installed)
        if (installedVariant) {
          this.mockEngines[name].default = {
            variant: installedVariant.variant,
            version: installedVariant.version
          }
        } else {
          // No installed variants remain, clear default
          this.mockEngines[name].default = { variant: '', version: '' }
        }
      }
      
      return { messages: `Successfully uninstalled ${name} ${engineConfig.variant} ${engineConfig.version}` }
    } else {
      return { messages: `Variant ${engineConfig.variant} ${engineConfig.version} not found for engine ${name}` }
    }
  }

  async getDefaultEngineVariant(
    name: InferenceEngine
  ): Promise<DefaultEngineVariant> {
    if (!this.mockEngines[name]) {
      return { variant: '', version: '' }
    }
    
    return this.mockEngines[name].default
  }

  async setDefaultEngineVariant(
    name: InferenceEngine,
    engineConfig: EngineConfig
  ): Promise<{ messages: string }> {
    if (!this.mockEngines[name]) {
      return { messages: `Engine ${name} not found` }
    }
    
    const variantExists = this.mockEngines[name].variants.some(
      v => v.variant === engineConfig.variant && v.version === engineConfig.version && v.installed
    )
    
    if (!variantExists) {
      return { messages: `Variant ${engineConfig.variant} ${engineConfig.version} not found or not installed` }
    }
    
    this.mockEngines[name].default = {
      variant: engineConfig.variant,
      version: engineConfig.version
    }
    
    return { messages: `Successfully set ${engineConfig.variant} ${engineConfig.version} as default for ${name}` }
  }

  async updateEngine(
    name: InferenceEngine,
    engineConfig?: EngineConfig
  ): Promise<{ messages: string }> {
    if (!this.mockEngines[name]) {
      return { messages: `Engine ${name} not found` }
    }
    
    if (!engineConfig) {
      // Assume we're updating to the latest version
      return { messages: `Successfully updated ${name} to the latest version` }
    }
    
    const variantIndex = this.mockEngines[name].variants.findIndex(
      v => v.variant === engineConfig.variant && v.installed
    )
    
    if (variantIndex >= 0) {
      // Update the version
      this.mockEngines[name].variants[variantIndex].version = engineConfig.version
      
      // If this was the default variant, update default version too
      if (this.mockEngines[name].default.variant === engineConfig.variant) {
        this.mockEngines[name].default.version = engineConfig.version
      }
      
      return { messages: `Successfully updated ${name} ${engineConfig.variant} to version ${engineConfig.version}` }
    } else {
      return { messages: `Installed variant ${engineConfig.variant} not found for engine ${name}` }
    }
  }

  async addRemoteModel(model: Model): Promise<void> {
    const engine = model.engine as string
    
    if (!this.remoteModels[engine]) {
      this.remoteModels[engine] = []
    }
    
    this.remoteModels[engine].push(model)
  }

  async getRemoteModels(name: InferenceEngine | string): Promise<Model[]> {
    return this.remoteModels[name] || []
  }
}

describe('EngineManagementExtension', () => {
  let extension: MockEngineManagementExtension

  beforeEach(() => {
    extension = new MockEngineManagementExtension()
  })

  test('should return the correct extension type', () => {
    expect(extension.type()).toBe(ExtensionTypeEnum.Engine)
  })

  test('should get all engines', async () => {
    const engines = await extension.getEngines()
    
    expect(engines).toBeDefined()
    expect(engines.llama).toBeDefined()
    expect(engines.gpt4all).toBeDefined()
    expect(engines.llama.variants).toHaveLength(2)
    expect(engines.gpt4all.variants).toHaveLength(1)
  })

  test('should get installed engines', async () => {
    const llamaEngines = await extension.getInstalledEngines('llama')
    
    expect(llamaEngines).toHaveLength(1)
    expect(llamaEngines[0].variant).toBe('cpu')
    expect(llamaEngines[0].installed).toBe(true)
    
    const gpt4allEngines = await extension.getInstalledEngines('gpt4all')
    
    expect(gpt4allEngines).toHaveLength(1)
    expect(gpt4allEngines[0].variant).toBe('cpu')
    expect(gpt4allEngines[0].installed).toBe(true)
    
    // Test non-existent engine
    const nonExistentEngines = await extension.getInstalledEngines('non-existent' as InferenceEngine)
    expect(nonExistentEngines).toHaveLength(0)
  })

  test('should get released engines by version', async () => {
    const llamaReleases = await extension.getReleasedEnginesByVersion('llama', '1.0.0')
    
    expect(llamaReleases).toHaveLength(2)
    expect(llamaReleases[0].variant).toBe('cpu')
    expect(llamaReleases[1].variant).toBe('cuda')
    
    // Test with platform filter
    const llamaLinuxReleases = await extension.getReleasedEnginesByVersion('llama', '1.0.0', 'linux')
    
    expect(llamaLinuxReleases).toHaveLength(2)
    
    const llamaMacReleases = await extension.getReleasedEnginesByVersion('llama', '1.0.0', 'macos')
    
    expect(llamaMacReleases).toHaveLength(1)
    expect(llamaMacReleases[0].variant).toBe('cpu')
    
    // Test non-existent version
    const nonExistentReleases = await extension.getReleasedEnginesByVersion('llama', '9.9.9')
    expect(nonExistentReleases).toHaveLength(0)
  })

  test('should get latest released engines', async () => {
    const latestLlamaReleases = await extension.getLatestReleasedEngine('llama')
    
    expect(latestLlamaReleases).toHaveLength(2)
    expect(latestLlamaReleases[0].version).toBe('1.1.0')
    
    // Test with platform filter
    const latestLlamaMacReleases = await extension.getLatestReleasedEngine('llama', 'macos')
    
    expect(latestLlamaMacReleases).toHaveLength(1)
    expect(latestLlamaMacReleases[0].variant).toBe('cpu')
    expect(latestLlamaMacReleases[0].version).toBe('1.1.0')
    
    // Test non-existent engine
    const nonExistentReleases = await extension.getLatestReleasedEngine('non-existent' as InferenceEngine)
    expect(nonExistentReleases).toHaveLength(0)
  })

  test('should install engine', async () => {
    // Install existing engine variant that is not installed
    const result = await extension.installEngine('llama', { variant: 'cuda', version: '1.0.0' })
    
    expect(result.messages).toContain('Successfully installed')
    
    const installedEngines = await extension.getInstalledEngines('llama')
    expect(installedEngines).toHaveLength(2)
    expect(installedEngines.some(e => e.variant === 'cuda')).toBe(true)
    
    // Install non-existent engine
    const newEngineResult = await extension.installEngine('new-engine', { variant: 'cpu', version: '1.0.0' })
    
    expect(newEngineResult.messages).toContain('Successfully installed')
    
    const engines = await extension.getEngines()
    expect(engines['new-engine']).toBeDefined()
    expect(engines['new-engine'].variants).toHaveLength(1)
    expect(engines['new-engine'].variants[0].installed).toBe(true)
  })

  test('should add remote engine', async () => {
    const result = await extension.addRemoteEngine({
      name: 'remote-llm',
      variant: 'remote',
      version: '1.0.0',
      url: 'https://example.com/remote-llm-api'
    })
    
    expect(result.messages).toContain('Successfully added remote engine')
    
    const engines = await extension.getEngines()
    expect(engines['remote-llm']).toBeDefined()
    expect(engines['remote-llm'].variants).toHaveLength(1)
    expect(engines['remote-llm'].variants[0].url).toBe('https://example.com/remote-llm-api')
  })

  test('should uninstall engine', async () => {
    const result = await extension.uninstallEngine('llama', { variant: 'cpu', version: '1.0.0' })
    
    expect(result.messages).toContain('Successfully uninstalled')
    
    const installedEngines = await extension.getInstalledEngines('llama')
    expect(installedEngines).toHaveLength(0)
    
    // Test uninstalling non-existent variant
    const nonExistentResult = await extension.uninstallEngine('llama', { variant: 'non-existent', version: '1.0.0' })
    
    expect(nonExistentResult.messages).toContain('not found')
  })

  test('should handle default variant when uninstalling', async () => {
    // First install cuda variant
    await extension.installEngine('llama', { variant: 'cuda', version: '1.0.0' })
    
    // Set cuda as default
    await extension.setDefaultEngineVariant('llama', { variant: 'cuda', version: '1.0.0' })
    
    // Check that cuda is now default
    let defaultVariant = await extension.getDefaultEngineVariant('llama')
    expect(defaultVariant.variant).toBe('cuda')
    
    // Uninstall cuda
    await extension.uninstallEngine('llama', { variant: 'cuda', version: '1.0.0' })
    
    // Check that default has changed to another installed variant
    defaultVariant = await extension.getDefaultEngineVariant('llama')
    expect(defaultVariant.variant).toBe('cpu')
    
    // Uninstall all variants
    await extension.uninstallEngine('llama', { variant: 'cpu', version: '1.0.0' })
    
    // Check that default is now empty
    defaultVariant = await extension.getDefaultEngineVariant('llama')
    expect(defaultVariant.variant).toBe('')
    expect(defaultVariant.version).toBe('')
  })

  test('should get default engine variant', async () => {
    const llamaDefault = await extension.getDefaultEngineVariant('llama')
    
    expect(llamaDefault.variant).toBe('cpu')
    expect(llamaDefault.version).toBe('1.0.0')
    
    // Test non-existent engine
    const nonExistentDefault = await extension.getDefaultEngineVariant('non-existent' as InferenceEngine)
    expect(nonExistentDefault.variant).toBe('')
    expect(nonExistentDefault.version).toBe('')
  })

  test('should set default engine variant', async () => {
    // Install cuda variant
    await extension.installEngine('llama', { variant: 'cuda', version: '1.0.0' })
    
    const result = await extension.setDefaultEngineVariant('llama', { variant: 'cuda', version: '1.0.0' })
    
    expect(result.messages).toContain('Successfully set')
    
    const defaultVariant = await extension.getDefaultEngineVariant('llama')
    expect(defaultVariant.variant).toBe('cuda')
    expect(defaultVariant.version).toBe('1.0.0')
    
    // Test setting non-existent variant as default
    const nonExistentResult = await extension.setDefaultEngineVariant('llama', { variant: 'non-existent', version: '1.0.0' })
    
    expect(nonExistentResult.messages).toContain('not found')
  })

  test('should update engine', async () => {
    const result = await extension.updateEngine('llama', { variant: 'cpu', version: '1.1.0' })
    
    expect(result.messages).toContain('Successfully updated')
    
    const engines = await extension.getEngines()
    const cpuVariant = engines.llama.variants.find(v => v.variant === 'cpu')
    expect(cpuVariant).toBeDefined()
    expect(cpuVariant?.version).toBe('1.1.0')
    
    // Default should also be updated since cpu was default
    expect(engines.llama.default.version).toBe('1.1.0')
    
    // Test updating non-existent variant
    const nonExistentResult = await extension.updateEngine('llama', { variant: 'non-existent', version: '1.1.0' })
    
    expect(nonExistentResult.messages).toContain('not found')
  })

  test('should add and get remote models', async () => {
    const model: Model = {
      id: 'remote-model-1',
      name: 'Remote Model 1',
      path: '/path/to/remote-model',
      engine: 'llama',
      format: 'gguf',
      modelFormat: 'gguf',
      source: 'remote',
      status: 'ready',
      contextLength: 4096,
      sizeInGB: 4,
      created: new Date().toISOString()
    }
    
    await extension.addRemoteModel(model)
    
    const llamaModels = await extension.getRemoteModels('llama')
    expect(llamaModels).toHaveLength(1)
    expect(llamaModels[0].id).toBe('remote-model-1')
    
    // Test non-existent engine
    const nonExistentModels = await extension.getRemoteModels('non-existent')
    expect(nonExistentModels).toHaveLength(0)
  })
})