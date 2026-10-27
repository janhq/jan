import { describe, expect, it } from 'vitest'
import { RESERVED_PUBLISHER, validateManifest } from '../manifest.js'
import { isContributionId } from '../index.js'

type Pkg = {
  name: string
  version: string
  engines?: Record<string, string>
  jan: Record<string, unknown>
}

const minimal = (): Pkg => ({
  name: 'hello-ext',
  version: '0.1.0',
  jan: {
    id: 'acme.hello',
    displayName: 'Hello',
    publisher: 'Acme',
    apiVersion: '^1.0.0',
    main: 'dist/index.js',
    permissions: [],
  },
})

const full = (): Pkg => ({
  name: '@acme/hello-provider',
  version: '1.2.3',
  engines: { jan: '>=0.9.0' },
  jan: {
    id: 'acme.hello-provider',
    displayName: '%displayName%',
    description: 'Says hello',
    publisher: 'Acme',
    apiVersion: '^1.0.0',
    main: './dist/index.js',
    permissions: [
      'ui:notify',
      'tools',
      'providers',
      'network:127.0.0.1',
      'network:*.acme.dev',
    ],
    proposals: ['chat'],
    contributes: {
      settings: [
        {
          key: 'greeting',
          title: 'Greeting',
          control: { type: 'input', default: 'Hello' },
        },
        {
          key: 'apiKey',
          title: 'API key',
          secret: true,
          control: { type: 'input', inputType: 'text', default: '' },
        },
        {
          key: 'loud',
          title: 'Loud',
          control: { type: 'checkbox', default: false },
        },
        {
          key: 'mode',
          title: 'Mode',
          control: {
            type: 'dropdown',
            options: [{ value: 'a', label: 'A' }],
            default: 'a',
          },
        },
        {
          key: 'level',
          title: 'Level',
          control: { type: 'slider', min: 0, max: 10, step: 1, default: 5 },
        },
        {
          key: 'notes',
          title: 'Notes',
          control: { type: 'textarea', rows: 3, default: '' },
        },
      ],
      commands: [
        {
          id: 'hello.greet',
          title: '%greet%',
          category: 'Hello',
          icon: 'hand-stop',
        },
        { id: 'hello.copy', title: 'Copy' },
      ],
      menus: {
        'commandPalette': [{ command: 'hello.greet' }],
        'message/actions': [
          {
            command: 'hello.copy',
            when: 'message.role == assistant',
            group: 'x',
            order: 1,
          },
        ],
      },
      statusItems: [
        {
          id: 'hello.status',
          text: 'Hi',
          tooltip: 'Status',
          command: 'hello.greet',
          priority: 1,
        },
      ],
      tools: [
        {
          name: 'echo_upper',
          description: 'Uppercases its input',
          inputSchema: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
          },
        },
      ],
      providers: [
        {
          id: 'hello-local',
          displayName: 'Hello',
          baseUrl: 'http://127.0.0.1:11999/v1',
          apiKeySetting: 'apiKey',
        },
        {
          id: 'hello-cloud',
          displayName: 'Hello Cloud',
          baseUrl: 'https://api.acme.dev/v1',
          capabilities: ['completion', 'tools', 'vision'],
        },
      ],
    },
    l10n: {
      en: { displayName: 'Hello Provider', greet: 'Greet' },
      de: { greet: 'Gruessen' },
    },
  },
})

const contributes = (pkg: Pkg) =>
  pkg.jan.contributes as Record<string, unknown[] | Record<string, unknown[]>>

const errorPaths = (pkg: unknown): string[] => {
  const result = validateManifest(pkg)
  return result.ok ? [] : result.errors.map((e) => e.path)
}

describe('validateManifest', () => {
  it('accepts a minimal manifest', () => {
    const result = validateManifest(minimal())
    expect(result).toEqual({
      ok: true,
      manifest: { ...minimal().jan, name: 'hello-ext', version: '0.1.0' },
    })
  })

  it('accepts a full manifest and carries engines over', () => {
    const result = validateManifest(full())
    if (!result.ok) throw new Error(JSON.stringify(result.errors))
    expect(result.manifest.id).toBe('acme.hello-provider')
    expect(result.manifest.engines).toEqual({ jan: '>=0.9.0' })
    expect(result.manifest.contributes?.commands).toHaveLength(2)
  })

  it('rejects input that is not a package object', () => {
    expect(errorPaths(null)).toEqual([''])
    expect(errorPaths({ name: 'x', version: '1.0.0' })).toEqual(['jan'])
  })

  it('requires the package name and a semver version', () => {
    const pkg = minimal()
    pkg.name = ''
    pkg.version = '1.0'
    expect(errorPaths(pkg)).toEqual(['name', 'version'])
  })

  it.each([
    'Acme.hello',
    'acme',
    'acme.',
    '-acme.hello',
    'acme.hello.world',
    'a.b',
  ])('rejects the id %s', (id) => {
    const pkg = minimal()
    pkg.jan.id = id
    expect(errorPaths(pkg)).toEqual(['jan.id'])
  })

  it('reserves the jan publisher for built-ins', () => {
    const pkg = minimal()
    pkg.jan.id = `${RESERVED_PUBLISHER}.hello`
    const result = validateManifest(pkg)
    expect(result).toEqual({
      ok: false,
      errors: [
        {
          path: 'jan.id',
          message:
            "uses the publisher 'jan', which is reserved for Jan's built-in extensions",
        },
      ],
    })
    expect(validateManifest(pkg, { builtin: true })).toMatchObject({
      ok: true,
      manifest: { id: 'jan.hello' },
    })
  })

  it.each(['jan-samples.hello', 'janx.hello', 'acme.jan'])(
    'does not reserve the id %s',
    (id) => {
      const pkg = minimal()
      pkg.jan.id = id
      expect(errorPaths(pkg)).toEqual([])
    }
  )

  it.each(['0.1.0', '~0.1.0', '>=0.1.0', '^0.1', '^0.1.0 || ^0.2.0'])(
    'rejects the apiVersion %s',
    (v) => {
      const pkg = minimal()
      pkg.jan.apiVersion = v
      expect(errorPaths(pkg)).toEqual(['jan.apiVersion'])
    }
  )

  it.each([
    '../index.js',
    'dist/../../index.js',
    '/abs/index.js',
    'C:/index.js',
    'dist\\index.js',
    'dist/index.mjs',
    '',
  ])('rejects main %s', (main) => {
    const pkg = minimal()
    pkg.jan.main = main
    expect(errorPaths(pkg)).toEqual(['jan.main'])
  })

  it('rejects an unknown permission', () => {
    const pkg = minimal()
    pkg.jan.permissions = ['ui:notify', 'fs:write']
    expect(errorPaths(pkg)).toEqual(['jan.permissions[1]'])
  })

  it('rejects commands:execute, which API 1.0 does not have', () => {
    const pkg = minimal()
    pkg.jan.permissions = ['commands:execute']
    expect(errorPaths(pkg)).toEqual(['jan.permissions[0]'])
  })

  it.each([
    'network:',
    'network:https://acme.dev',
    'network:acme.dev:443',
    'network:*acme.dev',
    'network:acme..dev',
  ])('rejects the network permission %s', (perm) => {
    const pkg = minimal()
    pkg.jan.permissions = [perm]
    expect(errorPaths(pkg)).toEqual(['jan.permissions[0]'])
  })

  it('rejects a duplicate permission', () => {
    const pkg = minimal()
    pkg.jan.permissions = ['tools', 'tools']
    expect(errorPaths(pkg)).toEqual(['jan.permissions[1]'])
  })

  it('rejects an unknown proposal', () => {
    const pkg = minimal()
    pkg.jan.proposals = ['teleport']
    expect(errorPaths(pkg)).toEqual(['jan.proposals[0]'])
  })

  it('rejects unknown manifest fields so typos do not pass silently', () => {
    const pkg = minimal()
    pkg.jan.permision = []
    expect(errorPaths(pkg)).toEqual(['jan.permision'])
  })

  it('rejects an http provider baseUrl for a non-local host', () => {
    const pkg = full()
    const providers = contributes(pkg).providers as Record<string, unknown>[]
    providers[1].baseUrl = 'http://api.acme.dev/v1'
    expect(errorPaths(pkg)).toEqual(['jan.contributes.providers[1].baseUrl'])
  })

  it('rejects a provider without the matching network permission', () => {
    const pkg = full()
    pkg.jan.permissions = [
      'ui:notify',
      'tools',
      'providers',
      'network:127.0.0.1',
    ]
    expect(errorPaths(pkg)).toEqual(['jan.contributes.providers[1].baseUrl'])
  })

  it('rejects providers and tools without their permission', () => {
    const pkg = full()
    pkg.jan.permissions = [
      'ui:notify',
      'network:127.0.0.1',
      'network:*.acme.dev',
    ]
    expect(errorPaths(pkg)).toEqual([
      'jan.contributes.tools',
      'jan.contributes.providers',
    ])
  })

  it('rejects a model capability the host does not understand', () => {
    const pkg = full()
    const providers = contributes(pkg).providers as Record<string, unknown>[]
    providers[1].capabilities = ['tools', 'teleport']
    expect(errorPaths(pkg)).toEqual([
      'jan.contributes.providers[1].capabilities[1]',
    ])
  })

  it.each([[[]], ['tools'], [['tools', 'tools']]])(
    'rejects provider capabilities %j',
    (capabilities) => {
      const pkg = full()
      const providers = contributes(pkg).providers as Record<string, unknown>[]
      providers[1].capabilities = capabilities
      expect(errorPaths(pkg)).toEqual([
        expect.stringMatching(/^jan\.contributes\.providers\[1\]\.capabilities/),
      ])
    }
  )

  it('rejects a provider apiKeySetting that names no declared setting', () => {
    const pkg = full()
    const providers = contributes(pkg).providers as Record<string, unknown>[]
    providers[0].apiKeySetting = 'missing'
    expect(errorPaths(pkg)).toEqual([
      'jan.contributes.providers[0].apiKeySetting',
    ])
  })

  it('rejects a duplicate command id', () => {
    const pkg = full()
    const commands = contributes(pkg).commands as Record<string, unknown>[]
    commands[1].id = 'hello.greet'
    // The menu entry pointing at the old hello.copy is now dangling too.
    expect(errorPaths(pkg)).toEqual([
      'jan.contributes.commands[1].id',
      "jan.contributes.menus['message/actions'][0].command",
    ])
  })

  it('rejects contribution ids outside the id grammar', () => {
    const pkg = full()
    const c = contributes(pkg)
    ;(c.commands as Record<string, unknown>[])[1].id = '__proto__'
    ;(c.statusItems as Record<string, unknown>[])[0].id = 'has space'
    ;(c.tools as Record<string, unknown>[])[0].name = 'x'.repeat(65)
    ;(c.providers as Record<string, unknown>[])[0].id = '-lead'
    expect(errorPaths(pkg)).toEqual([
      'jan.contributes.commands[1].id',
      "jan.contributes.menus['message/actions'][0].command",
      'jan.contributes.statusItems[0].id',
      'jan.contributes.tools[0].name',
      'jan.contributes.providers[0].id',
    ])
    expect(isContributionId('hello.greet')).toBe(true)
    expect(isContributionId('echo_upper')).toBe(true)
    expect(isContributionId('constructor')).toBe(true)
    expect(isContributionId('__proto__')).toBe(false)
  })

  it('rejects a menu item pointing at an undeclared command', () => {
    const pkg = full()
    const menus = contributes(pkg).menus as Record<
      string,
      Record<string, unknown>[]
    >
    menus.commandPalette[0].command = 'hello.nope'
    expect(errorPaths(pkg)).toEqual([
      'jan.contributes.menus.commandPalette[0].command',
    ])
  })

  it('rejects an unknown menu location and when clause', () => {
    const pkg = full()
    const menus = contributes(pkg).menus as Record<
      string,
      Record<string, unknown>[]
    >
    menus['message/actions'][0].when = 'message.role == system'
    menus.sidebar = [{ command: 'hello.greet' }]
    expect(errorPaths(pkg)).toEqual([
      "jan.contributes.menus['message/actions'][0].when",
      'jan.contributes.menus.sidebar',
    ])
  })

  it('rejects a status item pointing at an undeclared command', () => {
    const pkg = full()
    const items = contributes(pkg).statusItems as Record<string, unknown>[]
    items[0].command = 'hello.nope'
    expect(errorPaths(pkg)).toEqual(['jan.contributes.statusItems[0].command'])
  })

  it('rejects a duplicate setting key and a mistyped default', () => {
    const pkg = full()
    const settings = contributes(pkg).settings as Record<string, unknown>[]
    settings[1].key = 'greeting'
    settings[2].control = { type: 'checkbox', default: 'yes' }
    expect(errorPaths(pkg)).toEqual([
      'jan.contributes.settings[1].key',
      'jan.contributes.settings[2].control.default',
      // apiKey no longer exists, so the provider reference dangles.
      'jan.contributes.providers[0].apiKeySetting',
    ])
  })

  it('rejects a secret on a control that does not hold a string', () => {
    const pkg = full()
    const settings = contributes(pkg).settings as Record<string, unknown>[]
    settings[2].secret = true
    expect(errorPaths(pkg)).toEqual(['jan.contributes.settings[2].secret'])
  })

  it('rejects a dropdown default that is not one of its options and an inverted slider', () => {
    const pkg = full()
    const settings = contributes(pkg).settings as Record<string, unknown>[]
    settings[3].control = {
      type: 'dropdown',
      options: [{ value: 'a', label: 'A' }],
      default: 'b',
    }
    settings[4].control = {
      type: 'slider',
      min: 10,
      max: 0,
      step: 1,
      default: 5,
    }
    expect(errorPaths(pkg)).toEqual([
      'jan.contributes.settings[3].control.default',
      'jan.contributes.settings[4].control',
    ])
  })

  it('rejects a tool whose input schema is not an object schema', () => {
    const pkg = full()
    const tools = contributes(pkg).tools as Record<string, unknown>[]
    tools[0].inputSchema = { type: 'string' }
    expect(errorPaths(pkg)).toEqual(['jan.contributes.tools[0].inputSchema'])
  })

  it('rejects a %key% missing from l10n.en', () => {
    const pkg = full()
    pkg.jan.l10n = {
      en: { displayName: 'Hello Provider' },
      de: { greet: 'Gruessen' },
    }
    expect(errorPaths(pkg)).toEqual(['jan.contributes.commands[0].title'])
  })

  it('rejects a %key% when there is no l10n at all', () => {
    const pkg = minimal()
    pkg.jan.displayName = '%name%'
    expect(errorPaths(pkg)).toEqual(['jan.displayName'])
  })

  it('reports every problem at once', () => {
    const pkg = minimal()
    pkg.jan.id = 'bad'
    pkg.jan.main = '../x.js'
    pkg.jan.permissions = ['nope']
    expect(errorPaths(pkg)).toEqual([
      'jan.id',
      'jan.main',
      'jan.permissions[0]',
    ])
  })
})
