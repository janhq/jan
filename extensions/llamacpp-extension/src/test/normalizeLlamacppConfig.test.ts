import { describe, it, expect } from 'vitest'
import { normalizeLlamacppConfig } from '@janhq/tauri-plugin-llamacpp-api'

describe('normalizeLlamacppConfig - speculative decoding fields', () => {
  const baseConfig = {
    version_backend: 'v1.0/standard',
    auto_update_engine: false,
    auto_unload: false,
    auto_restart_on_crash: false,
    timeout: 600,
    llamacpp_env: '',
    fit: false,
    fit_target: '',
    fit_ctx: '',
    chat_template: '',
    n_gpu_layers: 100,
    offload_mmproj: true,
    cpu_moe: false,
    n_cpu_moe: 0,
    override_tensor_buffer_t: '',
    ctx_size: 2048,
    threads: 0,
    threads_batch: 0,
    n_predict: 0,
    batch_size: 0,
    ubatch_size: 0,
    device: '',
    split_mode: 'layer',
    main_gpu: 0,
    flash_attn: 'auto',
    cont_batching: false,
    no_mmap: false,
    mlock: false,
    no_kv_offload: false,
    cache_type_k: 'f16',
    cache_type_v: 'f16',
    defrag_thold: 0.1,
    rope_scaling: 'none',
    rope_scale: 1.0,
    rope_freq_base: 0.0,
    rope_freq_scale: 1.0,
    ctx_shift: false,
    parallel: 1,
    reasoning: 'auto',
    cache_ram: -1,
    cache_reuse: 0,
    swa_full: false,
    keep: 0,
  }

  describe('draft_model_path', () => {
    it('defaults to empty string when missing', () => {
      const result = normalizeLlamacppConfig(baseConfig)
      expect(result.draft_model_path).toBe('')
    })

    it('returns the provided path string', () => {
      const result = normalizeLlamacppConfig({
        ...baseConfig,
        draft_model_path: '/path/to/draft.gguf',
      })
      expect(result.draft_model_path).toBe('/path/to/draft.gguf')
    })

    it('defaults to empty string when null', () => {
      const result = normalizeLlamacppConfig({
        ...baseConfig,
        draft_model_path: null,
      })
      expect(result.draft_model_path).toBe('')
    })

    it('defaults to empty string when undefined', () => {
      const result = normalizeLlamacppConfig({
        ...baseConfig,
        draft_model_path: undefined,
      })
      expect(result.draft_model_path).toBe('')
    })
  })

  describe('spec_type', () => {
    it('defaults to empty string when missing', () => {
      const result = normalizeLlamacppConfig(baseConfig)
      expect(result.spec_type).toBe('')
    })

    it('returns "ngram-mod"', () => {
      const result = normalizeLlamacppConfig({ ...baseConfig, spec_type: 'ngram-mod' })
      expect(result.spec_type).toBe('ngram-mod')
    })

    it('returns "ngram-simple"', () => {
      const result = normalizeLlamacppConfig({ ...baseConfig, spec_type: 'ngram-simple' })
      expect(result.spec_type).toBe('ngram-simple')
    })

    it('returns "ngram-cache"', () => {
      const result = normalizeLlamacppConfig({ ...baseConfig, spec_type: 'ngram-cache' })
      expect(result.spec_type).toBe('ngram-cache')
    })

    it('returns "none" as a plain string (caller decides whether to pass it)', () => {
      const result = normalizeLlamacppConfig({ ...baseConfig, spec_type: 'none' })
      expect(result.spec_type).toBe('none')
    })

    it('defaults to empty string when null', () => {
      const result = normalizeLlamacppConfig({ ...baseConfig, spec_type: null })
      expect(result.spec_type).toBe('')
    })
  })

  describe('draft_max', () => {
    it('defaults to 0 when missing', () => {
      const result = normalizeLlamacppConfig(baseConfig)
      expect(result.draft_max).toBe(0)
    })

    it('returns the configured integer value', () => {
      const result = normalizeLlamacppConfig({ ...baseConfig, draft_max: 16 })
      expect(result.draft_max).toBe(16)
    })

    it('converts string numbers to integers', () => {
      const result = normalizeLlamacppConfig({ ...baseConfig, draft_max: '32' })
      expect(result.draft_max).toBe(32)
    })

    it('returns 0 when null', () => {
      const result = normalizeLlamacppConfig({ ...baseConfig, draft_max: null })
      expect(result.draft_max).toBe(0)
    })

    it('truncates fractional values', () => {
      const result = normalizeLlamacppConfig({ ...baseConfig, draft_max: 16.9 })
      expect(result.draft_max).toBe(16)
    })

    it('clamps negative values to 0', () => {
      const result = normalizeLlamacppConfig({ ...baseConfig, draft_max: -3 })
      expect(result.draft_max).toBe(0)
    })
  })

  describe('draft_min', () => {
    it('defaults to 0 when missing', () => {
      const result = normalizeLlamacppConfig(baseConfig)
      expect(result.draft_min).toBe(0)
    })

    it('returns the configured integer value', () => {
      const result = normalizeLlamacppConfig({ ...baseConfig, draft_min: 4 })
      expect(result.draft_min).toBe(4)
    })

    it('converts string numbers to integers', () => {
      const result = normalizeLlamacppConfig({ ...baseConfig, draft_min: '2' })
      expect(result.draft_min).toBe(2)
    })

    it('returns 0 when null', () => {
      const result = normalizeLlamacppConfig({ ...baseConfig, draft_min: null })
      expect(result.draft_min).toBe(0)
    })

    it('clamps negative values to 0', () => {
      const result = normalizeLlamacppConfig({ ...baseConfig, draft_min: -1 })
      expect(result.draft_min).toBe(0)
    })
  })

  describe('all speculative fields together', () => {
    it('normalizes all speculative fields correctly from a full config', () => {
      const result = normalizeLlamacppConfig({
        ...baseConfig,
        draft_model_path: '/drafts/llama-3b.gguf',
        spec_type: 'ngram-mod',
        draft_max: 16,
        draft_min: 2,
      })

      expect(result.draft_model_path).toBe('/drafts/llama-3b.gguf')
      expect(result.spec_type).toBe('ngram-mod')
      expect(result.draft_max).toBe(16)
      expect(result.draft_min).toBe(2)
    })
  })
})
