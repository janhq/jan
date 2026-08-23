import { describe, it, expect, vi, beforeEach } from 'vitest'

const writtenFiles: Record<string, string> = {}
const modelYamls: Record<string, unknown> = {}

vi.mock('@janhq/core', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
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

  // Values are chosen to differ from llama.cpp's defaults: an equal value is
  // deliberately skipped now, since emitting one suppresses the GGUF's own
  // sampling recommendations. The two penalties set no such bit and are always
  // emitted, so their defaults are fine here.
  it('emits per-model sampling values with CLI-style INI keys', async () => {
    setupModel('s', {
      temperature: 0,
      top_k: 20,
      top_p: 0.9,
      min_p: 0.1,
      repeat_last_n: 128,
      repeat_penalty: 1.1,
      presence_penalty: 0.5,
      frequency_penalty: 0.25,
    })
    await generatePreset('/p', '/jan', CONFIG, { supportsMtp: false })
    const ini = writtenFiles['/p/router.preset.ini']
    expect(ini).toContain('temperature = 0')
    expect(ini).toContain('top-k = 20')
    expect(ini).toContain('top-p = 0.9')
    expect(ini).toContain('min-p = 0.1')
    expect(ini).toContain('repeat-last-n = 128')
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

describe('generatePreset parallel reservation', () => {
  it('adds one reserved background slot on top of the global parallel value', async () => {
    setupModel('llama', {})
    await generatePreset('/p', '/jan', { parallel: 1 } as any, {
      supportsMtp: false,
    })
    const ini = writtenFiles['/p/router.preset.ini']
    expect(ini).toContain('parallel = 2')
  })

  it('adds one reserved background slot on top of a per-model parallel override', async () => {
    setupModel('llama', { parallel: 3 })
    await generatePreset('/p', '/jan', {} as any, { supportsMtp: false })
    const ini = writtenFiles['/p/router.preset.ini']
    expect(ini).toContain('parallel = 4')
  })

  it('omits parallel when unset, leaving llama.cpp auto-default untouched', async () => {
    setupModel('llama', {})
    await generatePreset('/p', '/jan', {} as any, { supportsMtp: false })
    const ini = writtenFiles['/p/router.preset.ini']
    expect(ini).not.toContain('parallel =')
  })

  it('reserves no extra slot when reservedBackgroundSlots is 0 (global)', async () => {
    setupModel('llama', {})
    await generatePreset('/p', '/jan', { parallel: 1 } as any, {
      supportsMtp: false,
      reservedBackgroundSlots: 0,
    })
    const ini = writtenFiles['/p/router.preset.ini']
    expect(ini).toContain('parallel = 1')
  })

  it('reserves no extra slot when reservedBackgroundSlots is 0 (per-model)', async () => {
    setupModel('llama', { parallel: 3 })
    await generatePreset('/p', '/jan', {} as any, {
      supportsMtp: false,
      reservedBackgroundSlots: 0,
    })
    const ini = writtenFiles['/p/router.preset.ini']
    expect(ini).toContain('parallel = 3')
  })
})

describe('generatePreset kv-unified', () => {
  it('enables unified KV on auto when an explicit parallel is emitted', async () => {
    setupModel('llama', {})
    await generatePreset('/p', '/jan', { parallel: 1 } as any, {
      supportsMtp: false,
    })
    const ini = writtenFiles['/p/router.preset.ini']
    expect(ini).toContain('parallel = 2')
    expect(ini).toContain('kv-unified = true')
  })

  it('enables unified KV on auto when only a per-model parallel is emitted', async () => {
    setupModel('llama', { parallel: 3 })
    await generatePreset('/p', '/jan', {} as any, { supportsMtp: false })
    const ini = writtenFiles['/p/router.preset.ini']
    expect(ini).toContain('kv-unified = true')
  })

  it('omits kv-unified on auto when no explicit parallel is emitted', async () => {
    setupModel('llama', {})
    await generatePreset('/p', '/jan', {} as any, { supportsMtp: false })
    const ini = writtenFiles['/p/router.preset.ini']
    expect(ini).not.toContain('kv-unified')
  })

  it('respects an explicit off even when parallel is emitted', async () => {
    setupModel('llama', {})
    await generatePreset('/p', '/jan', { parallel: 1, kv_unified: 'off' } as any, {
      supportsMtp: false,
    })
    const ini = writtenFiles['/p/router.preset.ini']
    expect(ini).toContain('kv-unified = false')
  })

  it('respects an explicit on when no parallel is emitted', async () => {
    setupModel('llama', {})
    await generatePreset('/p', '/jan', { kv_unified: 'on' } as any, {
      supportsMtp: false,
    })
    const ini = writtenFiles['/p/router.preset.ini']
    expect(ini).toContain('kv-unified = true')
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

  // There is no engine-level ctx_size setting: the [*] value is purely an OOM
  // guard, and a user's choice belongs to the per-model ctx_len.
  it('uses the per-model ctx_size over the [*] guard', async () => {
    setupModel('llama', { ctx_size: 16384 })
    await generatePreset('/p', '/jan', { fit: false } as any, {
      supportsMtp: false,
    })
    const ini = writtenFiles['/p/router.preset.ini']
    expect(ini).toContain('ctx-size = 16384')
  })

  it('omits ctx-size when auto-fit is enabled', async () => {
    setupModel('llama', {})
    await generatePreset('/p', '/jan', { fit: true } as any, {
      supportsMtp: false,
    })
    const ini = writtenFiles['/p/router.preset.ini']
    expect(ini).not.toContain('ctx-size = 8192')
  })

  it('honors a per-model ctx_size = 0 override as native', async () => {
    setupModel('llama', { ctx_size: 0 })
    await generatePreset('/p', '/jan', { fit: false } as any, {
      supportsMtp: false,
    })
    const ini = writtenFiles['/p/router.preset.ini']
    // [*] keeps the guard, but the per-model section overrides it to native.
    expect(ini).toContain('ctx-size = 8192')
    expect(ini).toContain('ctx-size = 0')
  })
})

describe('generatePreset n-gpu-layers under fit', () => {
  // There is no engine-level n_gpu_layers setting either; offload is per-model.
  it('never emits an engine-level n-gpu-layers', async () => {
    setupModel('llama', {})
    await generatePreset('/p', '/jan', { fit: false } as any, {
      supportsMtp: false,
    })
    expect(writtenFiles['/p/router.preset.ini']).not.toContain('n-gpu-layers')
  })

  it('emits per-model n-gpu-layers when fit is off', async () => {
    setupModel('llama', { n_gpu_layers: 33 })
    await generatePreset('/p', '/jan', { fit: false } as any, {
      supportsMtp: false,
    })
    const ini = writtenFiles['/p/router.preset.ini']
    expect(ini).toContain('n-gpu-layers = 33')
  })

  it('omits per-model n-gpu-layers when auto-fit is enabled', async () => {
    setupModel('llama', { n_gpu_layers: 33 })
    await generatePreset('/p', '/jan', { fit: true } as any, {
      supportsMtp: false,
    })
    const ini = writtenFiles['/p/router.preset.ini']
    expect(ini).not.toContain('n-gpu-layers')
  })
})

describe('generatePreset context-shift', () => {
  it('emits context-shift = true when ctx_shift is enabled', async () => {
    setupModel('llama', {})
    await generatePreset('/p', '/jan', { ctx_shift: true } as any, {
      supportsMtp: false,
    })
    const ini = writtenFiles['/p/router.preset.ini']
    expect(ini).toContain('context-shift = true')
  })

  it('omits context-shift when disabled, matching llama.cpp own default', async () => {
    setupModel('llama', {})
    await generatePreset('/p', '/jan', { ctx_shift: false } as any, {
      supportsMtp: false,
    })
    const ini = writtenFiles['/p/router.preset.ini']
    expect(ini).not.toContain('context-shift')
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

describe('generatePreset global engine options', () => {
  const globalSection = () => {
    const ini = writtenFiles['/p/router.preset.ini']
    const end = ini.indexOf('\n[', ini.indexOf('[*]') + 1)
    return end === -1 ? ini : ini.slice(0, end)
  }

  // Only non-defaults are emitted, so the preset stays intent-revealing.
  it('omits every option left at its llama.cpp default', async () => {
    await generatePreset('/p', '/jan', {
      batch_size: 2048,
      ubatch_size: 512,
      n_cpu_moe: 0,
      no_kv_offload: false,
    } as any, { supportsMtp: true })
    const g = globalSection()
    expect(g).not.toContain('batch-size')
    expect(g).not.toContain('n-cpu-moe')
    expect(g).not.toContain('kv-offload')
  })

  it('emits batch-size when it differs from the 2048 default', async () => {
    await generatePreset('/p', '/jan', { batch_size: 4096 } as any, {
      supportsMtp: true,
    })
    expect(globalSection()).toContain('batch-size = 4096')
  })

  // ubatch-size was exposed without its logical counterpart, so a user could
  // set the physical batch but not the logical one it must not exceed.
  it('emits batch-size and ubatch-size independently', async () => {
    await generatePreset('/p', '/jan', {
      batch_size: 1024,
      ubatch_size: 256,
    } as any, { supportsMtp: true })
    const g = globalSection()
    expect(g).toContain('batch-size = 1024')
    expect(g).toContain('ubatch-size = 256')
  })

  it('emits n-cpu-moe only when at least one layer is pinned to the host', async () => {
    await generatePreset('/p', '/jan', { n_cpu_moe: 12 } as any, {
      supportsMtp: true,
    })
    expect(globalSection()).toContain('n-cpu-moe = 12')
  })

  it('floors a fractional n-cpu-moe rather than emitting a non-integer', async () => {
    await generatePreset('/p', '/jan', { n_cpu_moe: 3.7 } as any, {
      supportsMtp: true,
    })
    expect(globalSection()).toContain('n-cpu-moe = 3')
  })

  // Spelled as the negated half of llama.cpp's kv-offload pair; common_preset
  // inverts it, so `true` here really does disable offloading.
  it('emits no-kv-offload only when offloading is disabled', async () => {
    await generatePreset('/p', '/jan', { no_kv_offload: true } as any, {
      supportsMtp: true,
    })
    expect(globalSection()).toContain('no-kv-offload = true')
  })
})

describe('generatePreset upstream-default skipping', () => {
  const globalSection = () => {
    const ini = writtenFiles['/p/router.preset.ini']
    const end = ini.indexOf('\n[', ini.indexOf('[*]') + 1)
    return end === -1 ? ini : ini.slice(0, end)
  }
  const modelSection = (id: string) => {
    const ini = writtenFiles['/p/router.preset.ini']
    const start = ini.indexOf(`[${id}]`)
    const end = ini.indexOf('\n[', start + 1)
    return end === -1 ? ini.slice(start) : ini.slice(start, end)
  }

  // Passing any of these sets a bit that suppresses the GGUF's own
  // general.sampling.* recommendations, so an identical-looking default
  // silently overrode what the model asked for.
  it('omits sampling values equal to llama.cpp defaults', async () => {
    setupModel('m', {
      temperature: 0.8,
      top_k: 40,
      top_p: 0.95,
      min_p: 0.05,
      repeat_last_n: 64,
      repeat_penalty: 1.0,
    })
    await generatePreset('/p', '/jan', {} as any, { supportsMtp: true })
    const sec = modelSection('m')
    for (const k of ['temperature', 'top-k', 'top-p', 'min-p', 'repeat-last-n', 'repeat-penalty']) {
      expect(sec, k).not.toContain(`${k} = `)
    }
  })

  it('still emits a sampling value that differs from the default', async () => {
    setupModel('m', { temperature: 0.6, top_k: 20 })
    await generatePreset('/p', '/jan', {} as any, { supportsMtp: true })
    const sec = modelSection('m')
    expect(sec).toContain('temperature = 0.6')
    expect(sec).toContain('top-k = 20')
  })

  // temperature 0 is greedy decoding, an explicit choice, not a default.
  it('emits temperature = 0', async () => {
    setupModel('m', { temperature: 0 })
    await generatePreset('/p', '/jan', {} as any, { supportsMtp: true })
    expect(modelSection('m')).toContain('temperature = 0')
  })

  // Upstream throws on a negative window rather than clamping, which aborts
  // the load; the old UI documented -1 as "full context".
  it('omits a negative repeat-last-n', async () => {
    setupModel('m', { repeat_last_n: -1 })
    await generatePreset('/p', '/jan', {} as any, { supportsMtp: true })
    expect(modelSection('m')).not.toContain('repeat-last-n')
  })

  // Upstream's fit leaves a user-set context alone, so gating this on fit was
  // why "Increase Context Size" did nothing while Fit was on.
  it('emits per-model ctx-size even when fit is enabled', async () => {
    setupModel('m', { ctx_size: 16384 })
    await generatePreset('/p', '/jan', { fit: true } as any, { supportsMtp: true })
    expect(modelSection('m')).toContain('ctx-size = 16384')
  })

  it('emits n-gpu-layers for auto (-1) and all (-2) but not below', async () => {
    setupModel('a', { n_gpu_layers: -1 })
    await generatePreset('/p', '/jan', { fit: false } as any, { supportsMtp: true })
    expect(modelSection('a')).toContain('n-gpu-layers = -1')

    setupModel('b', { n_gpu_layers: -2 })
    await generatePreset('/p', '/jan', { fit: false } as any, { supportsMtp: true })
    expect(modelSection('b')).toContain('n-gpu-layers = -2')

    setupModel('c', { n_gpu_layers: -3 })
    await generatePreset('/p', '/jan', { fit: false } as any, { supportsMtp: true })
    expect(modelSection('c')).not.toContain('n-gpu-layers')
  })

  // mlock and no_mmap are two deprecated aliases for one upstream field, so
  // emitting both left load_mode at NONE and silently dropped mlock.
  it('derives a single load-mode and never emits mlock or no-mmap', async () => {
    const cases: Array<[boolean, boolean, string | null]> = [
      [false, false, null],
      [false, true, 'load-mode = none'],
      [true, false, 'load-mode = mmap+mlock'],
      [true, true, 'load-mode = mlock'],
    ]
    for (const [mlock, no_mmap, expected] of cases) {
      await generatePreset('/p', '/jan', { mlock, no_mmap } as any, {
        supportsMtp: true,
      })
      const g = globalSection()
      expect(g, `mlock=${mlock} no_mmap=${no_mmap}`).not.toMatch(/^mlock = /m)
      expect(g).not.toMatch(/^no-mmap = /m)
      if (expected) expect(g).toContain(expected)
      else expect(g).not.toContain('load-mode')
    }
  })

  // Upstream's default is UNSPECIFIED, so treating 'none' as the default made
  // an explicit "disable scaling" impossible to express.
  it('emits rope-scaling for none but not for auto', async () => {
    await generatePreset('/p', '/jan', { rope_scaling: 'none' } as any, {
      supportsMtp: true,
    })
    expect(globalSection()).toContain('rope-scaling = none')

    await generatePreset('/p', '/jan', { rope_scaling: 'auto' } as any, {
      supportsMtp: true,
    })
    expect(globalSection()).not.toContain('rope-scaling')
  })

  // 1.0 is an explicit "force no scaling", not the default (which is 0).
  it('emits rope-freq-scale = 1 and omits it at 0', async () => {
    await generatePreset('/p', '/jan', { rope_freq_scale: 1 } as any, {
      supportsMtp: true,
    })
    expect(globalSection()).toContain('rope-freq-scale = 1')

    await generatePreset('/p', '/jan', { rope_freq_scale: 0 } as any, {
      supportsMtp: true,
    })
    expect(globalSection()).not.toContain('rope-freq-scale')
  })

  it('omits cache-ram at the upstream default and emits an explicit -1', async () => {
    await generatePreset('/p', '/jan', { cache_ram: 8192 } as any, {
      supportsMtp: true,
    })
    expect(globalSection()).not.toContain('cache-ram')

    await generatePreset('/p', '/jan', { cache_ram: -1 } as any, {
      supportsMtp: true,
    })
    expect(globalSection()).toContain('cache-ram = -1')
  })

  it('omits cont-batching when enabled and emits it only when turned off', async () => {
    await generatePreset('/p', '/jan', { cont_batching: true } as any, {
      supportsMtp: true,
    })
    expect(globalSection()).not.toContain('cont-batching')

    await generatePreset('/p', '/jan', { cont_batching: false } as any, {
      supportsMtp: true,
    })
    expect(globalSection()).toContain('cont-batching = false')
  })

  it('emits the newly exposed offload and checkpoint options only when set', async () => {
    await generatePreset('/p', '/jan', {} as any, { supportsMtp: true })
    let g = globalSection()
    expect(g).not.toContain('tensor-split')
    expect(g).not.toContain('no-op-offload')
    expect(g).not.toContain('ctx-checkpoints')
    expect(g).not.toContain('checkpoint-min-step')

    await generatePreset(
      '/p',
      '/jan',
      {
        tensor_split: ' 3,1 ',
        no_op_offload: true,
        ctx_checkpoints: 8,
        checkpoint_min_step: 4096,
      } as any,
      { supportsMtp: true }
    )
    g = globalSection()
    expect(g).toContain('tensor-split = 3,1')
    expect(g).toContain('no-op-offload = true')
    expect(g).toContain('ctx-checkpoints = 8')
    expect(g).toContain('checkpoint-min-step = 4096')
  })

  it('omits the checkpoint options at their upstream defaults', async () => {
    await generatePreset(
      '/p',
      '/jan',
      { ctx_checkpoints: 32, checkpoint_min_step: 8192 } as any,
      { supportsMtp: true }
    )
    const g = globalSection()
    expect(g).not.toContain('ctx-checkpoints')
    expect(g).not.toContain('checkpoint-min-step')
  })
})
