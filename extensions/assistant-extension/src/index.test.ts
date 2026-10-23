import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ServiceKeys,
  createServiceRegistry,
  type Assistant,
  type AssistantService,
  type InternalExtensionContext,
} from '@janhq/core'
import { activate } from './index'

// In-memory filesystem behind ctx.internal.fs. Keys are the virtual paths the
// extension builds.
const ROOT = 'file://assistants'
const VERSION_FILE = `${ROOT}/.migration_version`

let files: Map<string, string>
let dirs: Set<string>

function memoryFs() {
  return {
    existsSync: vi.fn(async (p: string) => dirs.has(p) || files.has(p)),
    mkdir: vi.fn(async (p: string) => void dirs.add(p)),
    writeFileSync: vi.fn(async (p: string, data: string) => {
      files.set(p, data)
    }),
    readFileSync: vi.fn(async (p: string) => {
      const data = files.get(p)
      if (data === undefined) throw new Error(`ENOENT: ${p}`)
      return data
    }),
    rm: vi.fn(async (p: string) => void files.delete(p)),
    readdirSync: vi.fn(async (p: string) => {
      const prefix = `${p}/`
      const names = new Set<string>()
      for (const key of [...files.keys(), ...dirs]) {
        if (key.startsWith(prefix))
          names.add(key.slice(prefix.length).split('/')[0])
      }
      return [...names]
    }),
  }
}

type Disposable = { dispose(): void }

// The parts of DisposableStore activate uses.
function subscriptions() {
  const items: Disposable[] = []
  return {
    add: <T extends Disposable>(d: T) => (items.push(d), d),
    dispose: () => items.splice(0).forEach((d) => d.dispose()),
  }
}

function fakeContext() {
  const fs = memoryFs()
  const services = createServiceRegistry()
  const ctx = {
    extension: { id: 'jan.assistant', version: '1.0.2', displayName: 'A' },
    subscriptions: subscriptions(),
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    internal: { services, fs },
  } as unknown as InternalExtensionContext
  return { ctx, fs, services }
}

async function activated() {
  const fake = fakeContext()
  await activate(fake.ctx)
  const service = fake.services.get(ServiceKeys.Assistants) as AssistantService
  return { ...fake, service }
}

function seedAssistant(id: string, data: Record<string, unknown>) {
  dirs.add(ROOT)
  dirs.add(`${ROOT}/${id}`)
  files.set(`${ROOT}/${id}/assistant.json`, JSON.stringify(data))
}

function readAssistant(id: string): Record<string, unknown> {
  return JSON.parse(files.get(`${ROOT}/${id}/assistant.json`) as string)
}

const assistant = (fields: Partial<Assistant>) => fields as Assistant

const DEFAULT_PARAMETERS = {
  temperature: 0.7,
  top_k: 20,
  top_p: 0.8,
  repeat_penalty: 1.12,
}

const IDENTITY_LINE =
  'You are Jan, a helpful AI assistant who assists users with their requests. Jan is trained by Menlo Research (https://www.menlo.ai).'

// The seeded default, read back from a fresh activation.
async function defaultAssistant(): Promise<Assistant> {
  const saved = { files, dirs }
  files = new Map()
  dirs = new Set()
  const { service } = await activated()
  const [seeded] = await service.getAssistants()
  ;({ files, dirs } = saved)
  return seeded
}

beforeEach(() => {
  files = new Map()
  dirs = new Set()
})

describe('activate', () => {
  it('provides the Assistants service until its subscriptions are disposed', async () => {
    const { ctx, services, service } = await activated()
    expect(service).toBeDefined()
    ctx.subscriptions.dispose()
    expect(services.get(ServiceKeys.Assistants)).toBeUndefined()
  })

  it('creates the assistants dir when missing', async () => {
    const { fs } = await activated()
    expect(fs.mkdir).toHaveBeenCalledWith(ROOT)
    expect(dirs.has(ROOT)).toBe(true)
  })

  it('records the current migration version', async () => {
    await activated()
    expect(files.get(VERSION_FILE)).toBe('3')
  })

  it('seeds the default assistant with parameters when none are persisted', async () => {
    await activated()
    const seeded = readAssistant('jan')
    expect(seeded.name).toBe('Jan')
    expect(seeded.avatar).toBe('\u{1F44B}')
    expect(seeded.parameters).toEqual(DEFAULT_PARAMETERS)
  })

  it('does not overwrite an existing persisted assistant', async () => {
    seedAssistant('jan', { id: 'jan', name: 'Custom', instructions: 'mine' })
    await activated()
    expect(readAssistant('jan').name).toBe('Custom')
  })
})

describe('getAssistants', () => {
  it('falls back to the default assistant when none are persisted', async () => {
    const { service } = await activated()
    files.delete(`${ROOT}/jan/assistant.json`)
    const result = await service.getAssistants()
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('jan')
    expect(result[0].name).toBe('Jan')
  })

  it('reads and parses stored assistants', async () => {
    seedAssistant('alpha', { id: 'alpha', name: 'Alpha' })
    seedAssistant('beta', { id: 'beta', name: 'Beta' })
    const { service } = await activated()
    const result = await service.getAssistants()
    expect(result.map((a) => a.id).sort()).toEqual(['alpha', 'beta'])
  })

  it('skips directories without an assistant.json', async () => {
    seedAssistant('alpha', { id: 'alpha', name: 'Alpha' })
    dirs.add(`${ROOT}/orphan`)
    const { service } = await activated()
    const result = await service.getAssistants()
    expect(result.map((a) => a.id)).toEqual(['alpha'])
  })

  it('skips assistants whose json fails to parse and keeps the valid ones', async () => {
    seedAssistant('alpha', { id: 'alpha', name: 'Alpha' })
    dirs.add(`${ROOT}/broken`)
    files.set(`${ROOT}/broken/assistant.json`, '{not valid json')
    const { service, ctx } = await activated()
    const result = await service.getAssistants()
    expect(result.map((a) => a.id)).toEqual(['alpha'])
    expect(ctx.log.error).toHaveBeenCalled()
  })
})

describe('createAssistant', () => {
  it('creates the assistant folder and writes pretty-printed assistant.json', async () => {
    const { service } = await activated()
    await service.createAssistant(assistant({ id: 'new', name: 'New' }))
    expect(dirs.has(`${ROOT}/new`)).toBe(true)
    expect(readAssistant('new')).toMatchObject({ id: 'new', name: 'New' })
    expect(files.get(`${ROOT}/new/assistant.json`)).toContain('\n  ')
  })

  it('does not recreate an existing folder but still writes the file', async () => {
    const { service, fs } = await activated()
    dirs.add(`${ROOT}/existing`)
    fs.mkdir.mockClear()
    await service.createAssistant(assistant({ id: 'existing', name: 'X' }))
    expect(fs.mkdir).not.toHaveBeenCalled()
    expect(readAssistant('existing')).toMatchObject({ id: 'existing' })
  })
})

describe('deleteAssistant', () => {
  it('removes assistant.json when it exists', async () => {
    seedAssistant('gone', { id: 'gone' })
    const { service } = await activated()
    await service.deleteAssistant(assistant({ id: 'gone' }))
    expect(files.has(`${ROOT}/gone/assistant.json`)).toBe(false)
  })

  it('is a no-op when the assistant does not exist', async () => {
    const { service, fs } = await activated()
    await service.deleteAssistant(assistant({ id: 'missing' }))
    expect(fs.rm).not.toHaveBeenCalled()
  })
})

describe('migrations', () => {
  it('v1 -> v3 carry the legacy instruction prefix through to the plain default', async () => {
    seedAssistant('a', {
      id: 'a',
      instructions: 'You are a helpful AI assistant. Be concise.',
    })
    const { instructions } = await defaultAssistant()
    await activated()
    const migrated = readAssistant('a')
    expect(migrated.instructions).toBe(instructions)
    expect(migrated.parameters).toEqual(DEFAULT_PARAMETERS)
  })

  it('v2 adds default parameters; v3 then strips the identity preamble it added', async () => {
    seedAssistant('b', {
      id: 'b',
      instructions: 'You are Jan, a helpful AI assistant. old body',
    })
    const { instructions } = await defaultAssistant()
    await activated()
    const migrated = readAssistant('b')
    expect(migrated.instructions).toBe(instructions)
    expect(migrated.instructions).not.toContain('Menlo Research')
    expect(migrated.parameters).toEqual(DEFAULT_PARAMETERS)
  })

  it('v3 strips the identity preamble when instructions match the verbatim v2 default', async () => {
    const { instructions } = await defaultAssistant()
    seedAssistant('c', {
      id: 'c',
      instructions: `${IDENTITY_LINE}\n\n${instructions}`,
    })
    await activated()
    expect(readAssistant('c').instructions).toBe(instructions)
  })

  it('leaves user-customized instructions untouched across all migrations', async () => {
    const custom = 'My totally custom system prompt.'
    seedAssistant('d', { id: 'd', instructions: custom })
    await activated()
    expect(readAssistant('d').instructions).toBe(custom)
  })

  it('does not re-run migrations when already at the current version', async () => {
    dirs.add(ROOT)
    files.set(VERSION_FILE, '3')
    seedAssistant('e', {
      id: 'e',
      instructions: 'You are a helpful AI assistant. legacy',
    })
    await activated()
    expect(readAssistant('e').instructions).toBe(
      'You are a helpful AI assistant. legacy'
    )
  })

  it('treats an unparseable migration version file as version 0 and runs migrations', async () => {
    dirs.add(ROOT)
    files.set(VERSION_FILE, 'garbage')
    await activated()
    expect(files.get(VERSION_FILE)).toBe('3')
  })
})
