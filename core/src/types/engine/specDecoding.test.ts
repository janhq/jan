import { describe, it, expect, beforeEach } from 'vitest'
import {
  isSpecConfig,
  setSpecConfig,
  isSpecDraftType,
  isSpecType,
  type SpecConfig,
  type SpecConfigKey,
} from './specDecoding'

describe('isSpecConfig', () => {
  it.each([
    'mtp_layers',
    'spec_type',
    'spec_draft_type',
    'spec_draft_model',
    'spec_draft_n_max',
    'spec_draft_n_min',
    'spec_draft_p_min',
    'spec_ngram_simple_size_n',
    'spec_ngram_simple_size_m',
    'spec_ngram_simple_min_hits',
    'spec_ngram_map_k_size_n',
    'spec_ngram_map_k_size_m',
    'spec_ngram_map_k_min_hits',
    'spec_ngram_map_k4v_size_n',
    'spec_ngram_map_k4v_size_m',
    'spec_ngram_map_k4v_min_hits',
    'spec_ngram_mod_n_match',
    'spec_ngram_mod_n_min',
    'spec_ngram_mod_n_max',
    'lookup_cache_static',
    'lookup_cache_dynamic',
  ])('returns true for "%s"', (key) => {
    expect(isSpecConfig(key)).toBe(true)
  })

  it.each(['unknown', '', 'Spec_type', 'mtp_layer', 'toString', 'constructor', null, undefined])(
    'returns false for %s',
    (key) => {
      expect(isSpecConfig(key)).toBe(false)
    }
  )
})

describe('setSpecConfig', () => {
  let cfg: SpecConfig

  beforeEach(() => {
    cfg = { mtp_layers: 4 }
  })

  describe('required config', () => {
    it('sets mtp_layers to a number', () => {
      setSpecConfig(cfg, 'mtp_layers', 8)

      expect(cfg.mtp_layers).toBe(8)
    })

    it('does not set mtp_layers to a string', () => {
      setSpecConfig(cfg, 'mtp_layers', '8')

      expect(cfg.mtp_layers).toBe(4)
    })

    it('does not set mtp_layers to null', () => {
      setSpecConfig(cfg, 'mtp_layers', null)

      expect(cfg.mtp_layers).toBe(4)
    })
  })

  describe('optional string config', () => {
    it.each([
      'spec_type',
      'spec_draft_type',
      'spec_draft_model',
      'lookup_cache_static',
      'lookup_cache_dynamic',
    ] as const)('sets %s to a string', (key: Extract<SpecConfigKey, string>) => {
      setSpecConfig(cfg, key, 'test-value')

      expect(cfg[key]).toBe('test-value')
    })

    it.each([123, null, undefined, true, {}, new String('test-value')])(
      'does not set a string field to %s',
      (value) => {
        cfg.spec_type = 'original'

        setSpecConfig(cfg, 'spec_type', value)

        expect(cfg.spec_type).toBe('original')
      }
    )
  })

  describe('optional number config', () => {
    it.each([
      'spec_draft_n_max',
      'spec_draft_n_min',
      'spec_draft_p_min',
      'spec_ngram_simple_size_n',
      'spec_ngram_simple_size_m',
      'spec_ngram_simple_min_hits',
      'spec_ngram_map_k_size_n',
      'spec_ngram_map_k_size_m',
      'spec_ngram_map_k_min_hits',
      'spec_ngram_map_k4v_size_n',
      'spec_ngram_map_k4v_size_m',
      'spec_ngram_map_k4v_min_hits',
      'spec_ngram_mod_n_match',
      'spec_ngram_mod_n_min',
      'spec_ngram_mod_n_max',
    ] as const)('sets %s to a number', (key: Extract<SpecConfigKey, string>) => {
      setSpecConfig(cfg, key, 12)

      expect(cfg[key]).toBe(12)
    })

    it.each(['12', null, undefined, true, Infinity, NaN, {}, new Number(12)])(
      'does not set a number field to %s',
      (value) => {
        cfg.spec_draft_n_max = 5

        setSpecConfig(cfg, 'spec_draft_n_max', value)

        expect(cfg.spec_draft_n_max).toBe(5)
      }
    )
  })
})

describe('isSpecDraftType', () => {
  it.each(['draft-simple', 'draft-mtp', 'draft-eagle3', 'draft-dflash', 'draft-dspark'])(
    'returns true for "%s"',
    (value) => {
      expect(isSpecDraftType(value)).toBe(true)
    }
  )

  it.each(['draft-unknown', '', 'draft-Simple', 'simple', null, undefined])(
    'returns false for %s',
    (value) => {
      expect(isSpecDraftType(value)).toBe(false)
    }
  )
})

describe('isSpecType', () => {
  it.each([
    'draft-simple',
    'draft-mtp',
    'draft-eagle3',
    'draft-dflash',
    'draft-dspark',
    'ngram-simple',
    'ngram-map-k',
    'ngram-map-k4v',
    'ngram-mod',
    'ngram-cache',
    String('draft-simple'),
  ])('returns true for "%s"', (value) => {
    expect(isSpecType(value)).toBe(true)
  })

  it.each([
    'unknown',
    '',
    'draft-Simple',
    'ngram-unknown',
    null,
    undefined,
    new String('draft-simple'),
  ])('returns false for %s', (value) => {
    expect(isSpecType(value)).toBe(false)
  })
})
