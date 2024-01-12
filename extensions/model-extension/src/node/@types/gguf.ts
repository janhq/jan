/**
 *   yarn ts-to-zod src/server/services/llama/utils/parseMetadataTypes.ts src/server/services/llama/utils/parseMetadataTypes2.ts
 */

export type ArchitectureType =
  | 'llama'
  | 'mpt'
  | 'gptneox'
  | 'gptj'
  | 'gpt2'
  | 'bloom'
  | 'falcon'
  | 'rwkv'

export type BaseGGUFMetadata = {
  /**
   * the global alignment to use, as described above. This can vary to allow
   * for different alignment schemes, but it must be a multiple of 8. Some
   * writers may not write the alignment. If the alignment is not specified,
   * assume it is `32`.
   */
  alignment?: number
  /**
   * The author of the model.
   */
  author?: string
  /**
   * free-form description of the model including anything that isn't
   * covered by the other fields
   */
  description?: string
  /**
   * An enumerated value describing the type of the majority of the tensors
   * in the file. Optional; can be inferred from the tensor types.
   */
  file_type?: // TODO: need to map this
  | 'ALL_F32'
    | 'MOSTLY_F16'
    | 'MOSTLY_Q4_0'
    | 'MOSTLY_Q4_1'
    | 'MOSTLY_Q4_1_SOME_F16'
    /** @deprecated */
    | 'MOSTLY_Q4_2'
    /** @deprecated */
    | 'MOSTLY_Q4_3'
    | 'MOSTLY_Q8_0'
    | 'MOSTLY_Q5_0'
    | 'MOSTLY_Q5_1'
    | 'MOSTLY_Q2_K'
    | 'MOSTLY_Q3_K_S'
    | 'MOSTLY_Q3_K_M'
    | 'MOSTLY_Q3_K_L'
    | 'MOSTLY_Q4_K_S'
    | 'MOSTLY_Q4_K_M'
    | 'MOSTLY_Q5_K_S'
    | 'MOSTLY_Q5_K_M'
    | 'MOSTLY_Q6_K'
  /**
   * License of the model, expressed as a SPDX license expression
   * (e.g. `"MIT OR Apache-2.0`). *Should not* include any other information,
   * such as the license text or the URL to the license.
   */
  license?: string
  /**
   * The name of the model. This should be a human-readable name that can be
   * used to identify the model. It should be unique within the community
   * that the model is defined in.
   */
  name?: string
  /**
   * The version of the quantization format. Not required if the model is not
   * quantized (i.e. no tensors are quantized). If any tensors are quantized,
   * this must be present. This is separate to the quantization scheme of the
   * tensors itself; the quantization version may change without changing the
   * scheme's name (e.g. the quantization scheme is Q5_K, and the quantization
   * version is 4).
   **/
  quantization_version: number
  /**
   * Information about where this model came from. This is useful for tracking
   * the provenance of the model, and for finding the original source if the
   * model is modified. For a model that was converted from GGML, for
   * example, these keys would point to the model that was converted from.
   */
  source?: {
    huggingface?: {
      /**
       * Hugging Face model repository that this model is either hosted on
       * or based on
       **/
      repository?: string
    }
    /**
     * URL to the source of the model. Can be a GitHub repo, a paper, etc.
     **/
    url?: string
  }
  /**
   * URL to the model's homepage. This can be a GitHub repo, a paper, etc.
   */
  url?: string
}

export type LlamaMetadata = {
  general: BaseGGUFMetadata & {
    /**
     * describes what architecture this model implements. All lowercase ASCII,
     * with only [a-z0-9]+ characters allowed.
     **/
    architecture: 'llama'
  }
  llama: {
    attention: {
      /** Also known as n_head. Number of attention heads. */
      head_count: number
      /** The number of heads per group used in Grouped-Query-Attention. If not
       * present or if present and equal to [llm].attention.head_count, the model
       * does not use GQA. */
      head_count_kv?: number
      /** Layer RMS normalization epsilon. */
      layer_norm_rms_epsilon: number
    }
    /** Also known as n_ctx. length of the context (in tokens) that the model was
     * trained on. For most architectures, this is the hard limit on the length of
     * the input. Architectures, like RWKV, that are not reliant on
     * transformer-style attention may be able to handle larger inputs,
     * but this is not guaranteed
     **/
    context_length: number
    /** Also known as n_embd. Embedding layer size. */
    embedding_length: number
    /** Also known as n_ff. The length of the feedforward layer. */
    feed_forward_length: number
    /** todo: In the spec this is always defined but in testing it is not */
    layer_count?: number
    rope: {
      /** The number of rotary dimensions for RoPE. */
      dimension_count: number
      freq_base?: number
      scale?: number
      scale_linear?: number
    }
    /** When a model is converted to GGUF, tensors may be rearranged to improve
     * performance. This key describes the layout of the tensor data. This is not
     * required; if not present, it is assumed to be `reference`.
     * `reference`: tensors are laid out in the same order as the original model */
    tensor_data_layout?: string
  }
}

export type MPTMetadata = {
  general: BaseGGUFMetadata & {
    /**
     * describes what architecture this model implements. All lowercase ASCII,
     * with only [a-z0-9]+ characters allowed.
     **/
    architecture: 'mpt'
  }
  mpt: {
    attention: {
      alibi_bias_max: number
      clip_kqv: number
      /** Also known as n_head. Number of attention heads. */
      head_count: number
      /** Layer normalization epsilon. */
      layer_norm_epsilon: number
    }
    /** Also known as n_ctx. length of the context (in tokens) that the model was
     * trained on. For most architectures, this is the hard limit on the length of
     * the input. Architectures, like RWKV, that are not reliant on
     * transformer-style attention may be able to handle larger inputs,
     * but this is not guaranteed
     **/
    context_length: number
    /** Also known as n_embd. Embedding layer size. */
    embedding_length: number
    layer_count: number
  }
}

export type GPTNeoXMetadata = {
  general: BaseGGUFMetadata & {
    /**
     * describes what architecture this model implements. All lowercase ASCII,
     * with only [a-z0-9]+ characters allowed.
     **/
    architecture: 'gptneox'
  }
  gptneox: {
    attention: {
      /** Also known as n_head. Number of attention heads. */
      head_count: number
      /** Layer normalization epsilon. */
      layer_norm_epsilon: number
    }
    /** Also known as n_ctx. length of the context (in tokens) that the model was
     * trained on. For most architectures, this is the hard limit on the length of
     * the input. Architectures, like RWKV, that are not reliant on
     * transformer-style attention may be able to handle larger inputs,
     * but this is not guaranteed
     **/
    context_length: number
    /** Also known as n_embd. Embedding layer size. */
    embedding_length: number
    layer_count: number
    rope: {
      /** The number of rotary dimensions for RoPE. */
      dimension_count: number
      scale?: number
    }
    /** Whether or not the parallel residual logic should be used. */
    use_parallel_residual: boolean
  }
}

export type GPTJMetadata = {
  general: BaseGGUFMetadata & {
    /**
     * describes what architecture this model implements. All lowercase ASCII,
     * with only [a-z0-9]+ characters allowed.
     **/
    architecture: 'gptj'
  }
  gptj: {
    attention: {
      /** Also known as n_head. Number of attention heads. */
      head_count: number
      /** Layer normalization epsilon. */
      layer_norm_epsilon: number
    }
    /** Also known as n_ctx. length of the context (in tokens) that the model was
     * trained on. For most architectures, this is the hard limit on the length of
     * the input. Architectures, like RWKV, that are not reliant on
     * transformer-style attention may be able to handle larger inputs,
     * but this is not guaranteed
     **/
    context_length: number
    /** Also known as n_embd. Embedding layer size. */
    embedding_length: number
    layer_count: number
    rope: {
      /** The number of rotary dimensions for RoPE. */
      dimension_count: number
      scale?: number
    }
  }
}

export type GPT2Metadata = {
  general: BaseGGUFMetadata & {
    /**
     * describes what architecture this model implements. All lowercase ASCII,
     * with only [a-z0-9]+ characters allowed.
     **/
    architecture: 'gpt2'
  }
  gpt2: {
    attention: {
      /** Also known as n_head. Number of attention heads. */
      head_count: number
      /** Layer normalization epsilon. */
      layer_norm_epsilon: number
    }
    /** Also known as n_ctx. length of the context (in tokens) that the model was
     * trained on. For most architectures, this is the hard limit on the length of
     * the input. Architectures, like RWKV, that are not reliant on
     * transformer-style attention may be able to handle larger inputs,
     * but this is not guaranteed
     **/
    context_length: number
    /** Also known as n_embd. Embedding layer size. */
    embedding_length: number
    layer_count: number
  }
}

export type BloomMetadata = {
  bloom: {
    attention: {
      /** Also known as n_head. Number of attention heads. */
      head_count: number
      /** Layer normalization epsilon. */
      layer_norm_epsilon: number
    }
    /** Also known as n_ctx. length of the context (in tokens) that the model was
     * trained on. For most architectures, this is the hard limit on the length of
     * the input. Architectures, like RWKV, that are not reliant on
     * transformer-style attention may be able to handle larger inputs,
     * but this is not guaranteed
     **/
    context_length: number
    /** Also known as n_embd. Embedding layer size. */
    embedding_length: number
    /** Also known as n_ff. The length of the feedforward layer. */
    feed_forward_length: number
    layer_count: number
  }
  general: BaseGGUFMetadata & {
    /**
     * describes what architecture this model implements. All lowercase ASCII,
     * with only [a-z0-9]+ characters allowed.
     **/
    architecture: 'bloom'
  }
}

export type FalconMetadata = {
  falcon: {
    attention: {
      /** Also known as n_head. Number of attention heads. */
      head_count: number
      /** The number of heads per group used in Grouped-Query-Attention. If
       * not present or if present and equal to attention.head_count,
       * the model does not use GQA. */
      head_count_kv: number
      /** Layer normalization epsilon. */
      layer_norm_epsilon: number
      use_norm: boolean
    }
    /** Also known as n_ctx. length of the context (in tokens) that the model was
     * trained on. For most architectures, this is the hard limit on the length of
     * the input. Architectures, like RWKV, that are not reliant on
     * transformer-style attention may be able to handle larger inputs,
     * but this is not guaranteed
     **/
    context_length: number
    /** Also known as n_embd. Embedding layer size. */
    embedding_length: number
    layer_count: number
    /** When a model is converted to GGUF, tensors may be rearranged to improve
     * performance. This key describes the layout of the tensor data. This is not
     * required; if not present, it is assumed to be `reference`.
     * `reference`: tensors are laid out in the same order as the original model */
    tensor_data_layout?: string
  }
  general: BaseGGUFMetadata & {
    /**
     * describes what architecture this model implements. All lowercase ASCII,
     * with only [a-z0-9]+ characters allowed.
     **/
    architecture: 'falcon'
  }
}

export type RWKVMetadata = {
  general: BaseGGUFMetadata & {
    /**
     * describes what architecture this model implements. All lowercase ASCII,
     * with only [a-z0-9]+ characters allowed.
     **/
    architecture: 'rwkv'
  }
  rwkv: {
    architecture_version: number
    /** Length of the context used during training or fine-tuning. RWKV is able
     * to handle larger context than this limit, but the output quality
     * may suffer. */
    context_length: number
    /** Also known as n_embd. Embedding layer size. */
    embedding_length: number
    /** Also known as n_ff. The length of the feedforward layer. */
    feed_forward_length: number
    layer_count: number
  }
}

export type WhisperMetadata = {
  general: BaseGGUFMetadata & {
    /**
     * describes what architecture this model implements. All lowercase ASCII,
     * with only [a-z0-9]+ characters allowed.
     **/
    architecture: 'whisper'
  }
  whisper: {
    decoder: {
      attention: {
        /** Also known as n_head. Number of attention heads. */
        head_count: number
      }
      /** Length of the context used during training or fine-tuning. RWKV is able
       * to handle larger context than this limit, but the output quality
       * may suffer. */
      context_length: number
      /** Also known as n_embd. Embedding layer size. */
      embedding_length: number
      layer_count: number
    }
    encoder: {
      attention: {
        /** Also known as n_head. Number of attention heads. */
        head_count: number
      }
      /** Length of the context used during training or fine-tuning. RWKV is able
       * to handle larger context than this limit, but the output quality
       * may suffer. */
      context_length: number
      /** Also known as n_embd. Embedding layer size. */
      embedding_length: number
      layer_count: number
      mels_count: number
    }
  }
}

export type GGUFMetadata =
  | LlamaMetadata
  | MPTMetadata
  | GPTNeoXMetadata
  | GPTJMetadata
  | GPT2Metadata
  | BloomMetadata
  | FalconMetadata
  | RWKVMetadata
  | WhisperMetadata
