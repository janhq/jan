import { describe, it, expect, vi, beforeEach } from 'vitest'

const writtenFiles: Record<string, string> = {}
const modelYamls: Record<string, unknown> = {}

vi.mock('@janhq/core', () => ({
  fs: {
    existsSync: vi.fn(async (p: string) => p === '/p/models' || p in modelYamls),
    mkdir: vi.fn(async () => undefined),
    readdirSync: vi.fn(async (dir: string) => {
      if (dir === '/p/models') {
        const ids = new Set(
          Object.keys(modelYamls).map((k) =>
            k.slice('/p/models/'.length).split('/')[0]
          )
        )
        return Array.from(ids).map((id) => `/p/models/${id}`)
      }
      return []
    }),
    fileStat: vi.fn(async (p: string) => ({
      isDirectory: !p.endsWith('model.yml'),
    })),
    writeFileSync: vi.fn(async (p: string, body: string) => {
      writtenFiles[p] = body
    }),
    mv: vi.fn(async (from: string, to: string) => {
      writtenFiles[to] = writtenFiles[from]
      delete writtenFiles[from]
    }),
    rm: vi.fn(async () => undefined),
  },
  joinPath: vi.fn(async (parts: string[]) => parts.join('/')),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (_cmd: string, args: { path: string }) => modelYamls[args.path]),
}))

import { generatePreset } from './preset'

const CONFIG = {} as any

beforeEach(() => {
  for (const k of Object.keys(writtenFiles)) delete writtenFiles[k]
  for (const k of Object.keys(modelYamls)) delete modelYamls[k]
})

function setupModel(id: string, yaml: Record<string, unknown>) {
  modelYamls[`/p/models/${id}/model.yml`] = {
    model_path: `models/${id}/model.gguf`,
    ...yaml,
  }
}

describe('generatePreset MTP emission', () => {
  it('emits spec-type = draft-mtp when mtp is on, layers > 0, and backend supports it', async () => {
    setupModel('glm', {
      mtp: true,
      mtp_layers: 1,
      spec_draft_n_max: 8,
      spec_draft_n_min: 0,
      spec_draft_p_min: 0.8,
    })
    await generatePreset('/p', '/jan', CONFIG, { supportsMtp: true })
    const ini = writtenFiles['/p/router.preset.ini']
    expect(ini).toContain('spec-type = draft-mtp')
    expect(ini).toContain('spec-draft-n-max = 8')
    expect(ini).toContain('spec-draft-n-min = 0')
    expect(ini).toContain('spec-draft-p-min = 0.8')
  })

  it('omits MTP lines when backend does not support MTP', async () => {
    setupModel('glm', { mtp: true, mtp_layers: 1, spec_draft_n_max: 8 })
    await generatePreset('/p', '/jan', CONFIG, { supportsMtp: false })
    const ini = writtenFiles['/p/router.preset.ini']
    expect(ini).not.toContain('spec-type')
    expect(ini).not.toContain('spec-draft')
  })

  it('omits MTP lines when model has no MTP heads (mtp_layers = 0)', async () => {
    setupModel('llama', { mtp: true, mtp_layers: 0 })
    await generatePreset('/p', '/jan', CONFIG, { supportsMtp: true })
    const ini = writtenFiles['/p/router.preset.ini']
    expect(ini).not.toContain('spec-type')
  })

  it('omits MTP lines when mtp flag is off even if heads exist', async () => {
    setupModel('glm', { mtp: false, mtp_layers: 1 })
    await generatePreset('/p', '/jan', CONFIG, { supportsMtp: true })
    const ini = writtenFiles['/p/router.preset.ini']
    expect(ini).not.toContain('spec-type')
  })

  it('skips out-of-range spec tunables', async () => {
    setupModel('glm', {
      mtp: true,
      mtp_layers: 1,
      spec_draft_n_max: -5,
      spec_draft_p_min: 1.5,
    })
    await generatePreset('/p', '/jan', CONFIG, { supportsMtp: true })
    const ini = writtenFiles['/p/router.preset.ini']
    expect(ini).toContain('spec-type = draft-mtp')
    expect(ini).not.toContain('spec-draft-n-max')
    expect(ini).not.toContain('spec-draft-p-min')
  })
})

describe('generatePreset ctx-size default', () => {
  it('emits ctx-size = 4096 in [*] when fit is off and no ctx_size is set', async () => {
    setupModel('llama', {})
    await generatePreset('/p', '/jan', { fit: false } as any, {
      supportsMtp: false,
    })
    const ini = writtenFiles['/p/router.preset.ini']
    expect(ini).toContain('ctx-size = 4096')
  })

  it('uses the user ctx_size over the default', async () => {
    setupModel('llama', {})
    await generatePreset('/p', '/jan', { fit: false, ctx_size: 8192 } as any, {
      supportsMtp: false,
    })
    const ini = writtenFiles['/p/router.preset.ini']
    expect(ini).toContain('ctx-size = 8192')
    expect(ini).not.toContain('ctx-size = 4096')
  })

  it('omits ctx-size when auto-fit is enabled', async () => {
    setupModel('llama', {})
    await generatePreset('/p', '/jan', { fit: true } as any, {
      supportsMtp: false,
    })
    const ini = writtenFiles['/p/router.preset.ini']
    expect(ini).not.toContain('ctx-size = 4096')
  })
})
