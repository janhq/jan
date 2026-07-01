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

  it('emits spec-draft-model for a separate MTP gguf even when main reports 0 heads', async () => {
    setupModel('gemma', {
      mtp: true,
      mtp_layers: 0,
      mtp_model_path: 'models/gemma/mtp.gguf',
    })
    await generatePreset('/p', '/jan', CONFIG, { supportsMtp: true })
    const ini = writtenFiles['/p/router.preset.ini']
    expect(ini).toContain('spec-type = draft-mtp')
    expect(ini).toContain('spec-draft-model = /jan/models/gemma/mtp.gguf')
  })

  it('does not emit spec-draft-model for embedded MTP (no draft path)', async () => {
    setupModel('glm', { mtp: true, mtp_layers: 1 })
    await generatePreset('/p', '/jan', CONFIG, { supportsMtp: true })
    const ini = writtenFiles['/p/router.preset.ini']
    expect(ini).toContain('spec-type = draft-mtp')
    expect(ini).not.toContain('spec-draft-model')
  })

  it('emits per-model sampling defaults with CLI-style INI keys', async () => {
    setupModel('s', {
      temperature: 0,
      top_k: 40,
      top_p: 0.9,
      min_p: 0.05,
      repeat_last_n: 64,
      repeat_penalty: 1.1,
      presence_penalty: 0.5,
      frequency_penalty: 0.25,
    })
    await generatePreset('/p', '/jan', CONFIG, { supportsMtp: false })
    const ini = writtenFiles['/p/router.preset.ini']
    expect(ini).toContain('temperature = 0')
    expect(ini).toContain('top-k = 40')
    expect(ini).toContain('top-p = 0.9')
    expect(ini).toContain('min-p = 0.05')
    expect(ini).toContain('repeat-last-n = 64')
    expect(ini).toContain('repeat-penalty = 1.1')
    expect(ini).toContain('presence-penalty = 0.5')
    expect(ini).toContain('frequency-penalty = 0.25')
  })

  it('omits sampling keys that are absent or non-numeric', async () => {
    setupModel('s', { temperature: 0.7 })
    await generatePreset('/p', '/jan', CONFIG, { supportsMtp: false })
    const ini = writtenFiles['/p/router.preset.ini']
    expect(ini).toContain('temperature = 0.7')
    expect(ini).not.toContain('top-p')
    expect(ini).not.toContain('min-p')
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
  it('emits ctx-size = 8192 in [*] when fit is off and no ctx_size is set', async () => {
    setupModel('llama', {})
    await generatePreset('/p', '/jan', { fit: false } as any, {
      supportsMtp: false,
    })
    const ini = writtenFiles['/p/router.preset.ini']
    expect(ini).toContain('ctx-size = 8192')
  })

  it('uses the user ctx_size over the default', async () => {
    setupModel('llama', {})
    await generatePreset('/p', '/jan', { fit: false, ctx_size: 16384 } as any, {
      supportsMtp: false,
    })
    const ini = writtenFiles['/p/router.preset.ini']
    expect(ini).toContain('ctx-size = 16384')
    expect(ini).not.toContain('ctx-size = 8192')
  })

  it('omits ctx-size when auto-fit is enabled', async () => {
    setupModel('llama', {})
    await generatePreset('/p', '/jan', { fit: true } as any, {
      supportsMtp: false,
    })
    const ini = writtenFiles['/p/router.preset.ini']
    expect(ini).not.toContain('ctx-size = 8192')
  })

  it('honors an explicit ctx_size = 0 as native instead of the 8192 fallback', async () => {
    setupModel('llama', {})
    await generatePreset('/p', '/jan', { fit: false, ctx_size: 0 } as any, {
      supportsMtp: false,
    })
    const ini = writtenFiles['/p/router.preset.ini']
    expect(ini).toContain('ctx-size = 0')
    expect(ini).not.toContain('ctx-size = 8192')
  })

  it('honors a per-model ctx_size = 0 override as native', async () => {
    setupModel('llama', { ctx_size: 0 })
    await generatePreset('/p', '/jan', { fit: false, ctx_size: 16384 } as any, {
      supportsMtp: false,
    })
    const ini = writtenFiles['/p/router.preset.ini']
    // [*] keeps the global, but the per-model section overrides to native.
    expect(ini).toContain('ctx-size = 16384')
    expect(ini).toContain('ctx-size = 0')
  })
})

describe('generatePreset embedding ctx-size', () => {
  it('pins embedders to native ctx-size = 0 so they do not inherit the global 8192', async () => {
    setupModel('minilm', { embedding: true })
    await generatePreset('/p', '/jan', { fit: false } as any, {
      supportsMtp: false,
    })
    const ini = writtenFiles['/p/router.preset.ini']
    expect(ini).toContain('embeddings = true')
    // global [*] still emits 8192, but the embedder section overrides to native.
    expect(ini).toContain('ctx-size = 8192')
    expect(ini).toContain('ctx-size = 0')
  })

  it('keeps a positive per-model embedder ctx-size instead of forcing native', async () => {
    setupModel('minilm', { embedding: true, ctx_size: 2048 })
    await generatePreset('/p', '/jan', { fit: false } as any, {
      supportsMtp: false,
    })
    const ini = writtenFiles['/p/router.preset.ini']
    expect(ini).toContain('embeddings = true')
    expect(ini).toContain('ctx-size = 2048')
    // the embedder section must not additionally emit native 0.
    const embedderSection = ini.slice(ini.indexOf('[minilm]'))
    expect(embedderSection).not.toContain('ctx-size = 0')
  })
})
