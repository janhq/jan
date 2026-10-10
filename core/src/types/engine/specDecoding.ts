export type SpecTypeParameter = {
  key: keyof SpecConfig
  translationPath: string
  step?: number
  default?: number
  min?: number
  max?: number
}

const specDraftTypeParameters: SpecTypeParameter[] = [
    { key: 'spec_draft_n_min', translationPath: 'specDraft.nMin', step: 1, default: 0, min: 0 },
    { key: 'spec_draft_n_max', translationPath: 'specDraft.nMax', step: 1, default: 3, min: 0 },
    { key: 'spec_draft_p_min', translationPath: 'specDraft.pMin', step: 0.05, default: 0.75, min: 0, max: 1 },
  ]

export const specTypeParameters: Partial<Record<typeof specTypes[number], SpecTypeParameter[]>> = {
  'draft-simple': specDraftTypeParameters,
  'draft-mtp': specDraftTypeParameters,
  'draft-eagle3': specDraftTypeParameters,
  'draft-dflash': specDraftTypeParameters,
  'draft-dspark': specDraftTypeParameters,
  'ngram-simple': [
    { key: 'spec_ngram_simple_size_n', translationPath: 'specNgram.sizeN', step: 1, default: 12, min: 1, max: 1024 },
    { key: 'spec_ngram_simple_size_m', translationPath: 'specNgram.sizeM', step: 4, default: 48, min: 4, max: 1024 },
    { key: 'spec_ngram_simple_min_hits', translationPath: 'specNgram.minHits', step: 1, default: 1, min: 1 },
  ],
  'ngram-map-k': [
    { key: 'spec_ngram_map_k_size_n', translationPath: 'specNgram.sizeN', step: 1, default: 12, min: 1, max: 1024 },
    { key: 'spec_ngram_map_k_size_m', translationPath: 'specNgram.sizeM', step: 4, default: 48, min: 4, max: 1024 },
    { key: 'spec_ngram_map_k_min_hits', translationPath: 'specNgram.minHits', step: 1, default: 1, min: 1 },
  ],
  'ngram-map-k4v': [
    { key: 'spec_ngram_map_k4v_size_n', translationPath: 'specNgram.sizeN', step: 1, default: 12, min: 1, max: 1024 },
    { key: 'spec_ngram_map_k4v_size_m', translationPath: 'specNgram.sizeM', step: 4, default: 48, min: 4, max: 1024 },
    { key: 'spec_ngram_map_k4v_min_hits', translationPath: 'specNgram.minHits', step: 1, default: 1, min: 1 },
  ],
  'ngram-mod': [
    { key: 'spec_ngram_mod_n_match', translationPath: 'specNgram.nMatch', step: 1, default: 24, min: 1, max: 1024 },
    { key: 'spec_ngram_mod_n_min', translationPath: 'specNgram.nMin', step: 1, default: 48, min: 0, max: 1024 },
    { key: 'spec_ngram_mod_n_max', translationPath: 'specNgram.nMax', step: 1, default: 64, min: 0, max: 1024 },
  ],
  'ngram-cache': [
    { key: 'lookup_cache_static', translationPath: 'specNgram.cacheStatic' },
    { key: 'lookup_cache_dynamic', translationPath: 'specNgram.cacheDynamic' },
  ],
}

const specConfigOptional = {
  spec_type: String,
  spec_draft_type: String,
  spec_draft_model: String,
  spec_draft_n_max: Number,
  spec_draft_n_min: Number,
  spec_draft_p_min: Number,
  spec_ngram_simple_size_n: Number,
  spec_ngram_simple_size_m: Number,
  spec_ngram_simple_min_hits: Number,
  spec_ngram_map_k_size_n: Number,
  spec_ngram_map_k_size_m: Number,
  spec_ngram_map_k_min_hits: Number,
  spec_ngram_map_k4v_size_n: Number,
  spec_ngram_map_k4v_size_m: Number,
  spec_ngram_map_k4v_min_hits: Number,
  spec_ngram_mod_n_match: Number,
  spec_ngram_mod_n_min: Number,
  spec_ngram_mod_n_max: Number,
  lookup_cache_static: String,
  lookup_cache_dynamic: String,
} as const

const specConfigRequired = {
  mtp_layers: Number
} as const

export const specConfig = {
  ...specConfigRequired,
  ...specConfigOptional
} as const

export type SpecConfig = {
  -readonly [K in keyof typeof specConfigRequired]:
    InstanceType<typeof specConfigRequired[K]>
} & Partial<{
  -readonly [K in keyof typeof specConfigOptional]:
    InstanceType<typeof specConfigOptional[K]>
}>
export type SpecConfigKey = Extract<keyof SpecConfig, string>
export type SpecConfigPatch = {
  [K in keyof SpecConfig]?: SpecConfig[K] | null
}
export function isSpecConfig(value: string | null | undefined): value is keyof SpecConfig {
  return value != null && value in specConfig
}
export function setSpecConfig(
  cfg: SpecConfig,
  key: keyof SpecConfig,
  value: unknown
): void {
  const type =
    key in specConfigRequired
      ? specConfigRequired[key as keyof typeof specConfigRequired] 
      : specConfigOptional[key as keyof typeof specConfigOptional]

  if (type === String && typeof value !== 'string') return
  if (type === Number && typeof value !== 'number') return

  cfg[key] = value as never
}

const specDraftTypes = [
  'draft-simple',
  'draft-mtp',
  'draft-eagle3',
  'draft-dflash',
  'draft-dspark',
] as const
export function isSpecDraftType(value: String | null | undefined): value is typeof specDraftTypes[number] {
  return specDraftTypes.includes(value as typeof specDraftTypes[number])
}

const specTypes = [
  ...specDraftTypes,
  'ngram-simple', 
  'ngram-map-k', 
  'ngram-map-k4v', 
  'ngram-mod', 
  'ngram-cache',
] as const
export function isSpecType(
  value: string | String | null | undefined
): value is string {
  return typeof value === 'string' && specTypes.includes(value as typeof specTypes[number])
}
