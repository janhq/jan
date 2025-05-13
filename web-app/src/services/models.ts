import { ExtensionManager } from '@/lib/extension'
import { ExtensionTypeEnum, ModelExtension } from '@janhq/core'

export const fetchModels = async () => {
  return ExtensionManager.getInstance()
    .get<ModelExtension>(ExtensionTypeEnum.Model)
    ?.getModels()
}

export const fetchModelSources = async () => {
  const extension = ExtensionManager.getInstance().get<ModelExtension>(
    ExtensionTypeEnum.Model
  )

  if (!extension) return []

  try {
    const sources = await extension.getSources()
    return sources.map((m) => ({
      ...m,
      models: m.models.sort((a, b) => a.size - b.size),
    }))
  } catch (error) {
    console.error('Failed to fetch model sources:', error)
    return []
  }
}

export const addModelSource = async (source: string) => {
  const extension = ExtensionManager.getInstance().get<ModelExtension>(
    ExtensionTypeEnum.Model
  )

  if (!extension) throw new Error('Model extension not found')

  try {
    return await extension.addSource(source)
  } catch (error) {
    console.error('Failed to add model source:', error)
    throw error
  }
}

export const deleteModelSource = async (source: string) => {
  const extension = ExtensionManager.getInstance().get<ModelExtension>(
    ExtensionTypeEnum.Model
  )

  if (!extension) throw new Error('Model extension not found')

  try {
    return await extension.deleteSource(source)
  } catch (error) {
    console.error('Failed to delete model source:', error)
    throw error
  }
}

export const modelSettings = {
  threads: {
    key: 'threads',
    title: 'Threads',
    description:
      'Number of threads to use during generation (-1 for logical cores).',
    controller_type: 'input',
    controller_props: {
      value: -1,
      placeholder: '-1',
      type: 'number',
    },
  },
  threads_batch: {
    key: 'threads_batch',
    title: 'Threads (Batch)',
    description:
      'Number of threads for batch and prompt processing (default: same as Threads).',
    controller_type: 'input',
    controller_props: {
      value: -1,
      placeholder: '-1 (same as Threads)',
      type: 'number',
    },
  },
  ctx_size: {
    key: 'ctx_size',
    title: 'Context Size',
    description: 'Size of the prompt context (0 = loaded from model).',
    controller_type: 'input',
    controller_props: {
      value: 8192,
      placeholder: '8192',
      type: 'number',
    },
  },
  n_predict: {
    key: 'n_predict',
    title: 'Max Tokens to Predict',
    description: 'Maximum number of tokens to generate (-1 = infinity).',
    controller_type: 'input',
    controller_props: {
      value: -1,
      placeholder: '-1',
      type: 'number',
    },
  },
  batch_size: {
    key: 'batch_size',
    title: 'Batch Size',
    description: 'Logical maximum batch size for processing prompts.',
    controller_type: 'input',
    controller_props: {
      value: 2048,
      placeholder: '2048',
      type: 'number',
    },
  },
  ubatch_size: {
    key: 'ubatch_size',
    title: 'uBatch Size',
    description: 'Physical maximum batch size for processing prompts.',
    controller_type: 'input',
    controller_props: {
      value: 512,
      placeholder: '512',
      type: 'number',
    },
  },
  n_gpu_layers: {
    key: 'n_gpu_layers',
    title: 'GPU Layers',
    description:
      'Number of model layers to offload to the GPU (-1 for all layers, 0 for CPU only).',
    controller_type: 'input',
    controller_props: {
      value: -1,
      placeholder: '-1',
      type: 'number',
    },
  },
  device: {
    key: 'device',
    title: 'Devices for Offload',
    description:
      "Comma-separated list of devices to use for offloading (e.g., 'cuda:0', 'cuda:0,cuda:1'). Leave empty to use default/CPU only.",
    controller_type: 'input',
    controller_props: {
      value: '',
      placeholder: 'cuda:0',
      type: 'text',
    },
  },
  split_mode: {
    key: 'split_mode',
    title: 'GPU Split Mode',
    description: 'How to split the model across multiple GPUs.',
    controller_type: 'dropdown',
    controller_props: {
      value: 'layer',
      options: [
        { value: 'none', name: 'None' },
        { value: 'layer', name: 'Layer' },
        { value: 'row', name: 'Row' },
      ],
    },
  },
  main_gpu: {
    key: 'main_gpu',
    title: 'Main GPU Index',
    description:
      'The GPU to use for the model (split-mode=none) or intermediate results (split-mode=row).',
    controller_type: 'input',
    controller_props: {
      value: 0,
      placeholder: '0',
      type: 'number',
    },
  },
  flash_attn: {
    key: 'flash_attn',
    title: 'Flash Attention',
    description: 'Enable Flash Attention for optimized performance.',
    controller_type: 'checkbox',
    controller_props: {
      value: false,
    },
  },
  cont_batching: {
    key: 'cont_batching',
    title: 'Continuous Batching',
    description:
      'Enable continuous batching (a.k.a dynamic batching) for concurrent requests (default: enabled).',
    controller_type: 'checkbox',
    controller_props: {
      value: true,
    },
  },
  no_mmap: {
    key: 'no_mmap',
    title: 'Disable mmap',
    description:
      'Do not memory-map model (slower load but may reduce pageouts if not using mlock).',
    controller_type: 'checkbox',
    controller_props: {
      value: false,
    },
  },
  mlock: {
    key: 'mlock',
    title: 'MLock',
    description:
      'Force system to keep model in RAM, preventing swapping/compression.',
    controller_type: 'checkbox',
    controller_props: {
      value: false,
    },
  },
  no_kv_offload: {
    key: 'no_kv_offload',
    title: 'Disable KV Offload',
    description: 'Disable KV cache offload to GPU (if GPU is used).',
    controller_type: 'checkbox',
    controller_props: {
      value: false,
    },
  },
  cache_type_k: {
    key: 'cache_type_k',
    title: 'KV Cache K Type',
    description: 'KV cache data type for Keys (default: f16).',
    controller_type: 'dropdown',
    controller_props: {
      value: 'f16',
      options: [
        { value: 'f32', name: 'f32' },
        { value: 'f16', name: 'f16' },
        { value: 'bf16', name: 'bf16' },
        { value: 'q8_0', name: 'q8_0' },
        { value: 'q4_0', name: 'q4_0' },
        { value: 'q4_1', name: 'q4_1' },
        { value: 'iq4_nl', name: 'iq4_nl' },
        { value: 'q5_0', name: 'q5_0' },
        { value: 'q5_1', name: 'q5_1' },
      ],
    },
  },
  cache_type_v: {
    key: 'cache_type_v',
    title: 'KV Cache V Type',
    description: 'KV cache data type for Values (default: f16).',
    controller_type: 'dropdown',
    controller_props: {
      value: 'f16',
      options: [
        { value: 'f32', name: 'f32' },
        { value: 'f16', name: 'f16' },
        { value: 'bf16', name: 'bf16' },
        { value: 'q8_0', name: 'q8_0' },
        { value: 'q4_0', name: 'q4_0' },
        { value: 'q4_1', name: 'q4_1' },
        { value: 'iq4_nl', name: 'iq4_nl' },
        { value: 'q5_0', name: 'q5_0' },
        { value: 'q5_1', name: 'q5_1' },
      ],
    },
  },
  defrag_thold: {
    key: 'defrag_thold',
    title: 'KV Cache Defragmentation Threshold',
    description: 'Threshold for KV cache defragmentation (< 0 to disable).',
    controller_type: 'input',
    controller_props: {
      value: 0.1,
      placeholder: '0.1',
      type: 'number',
      step: 0.01,
    },
  },
  rope_scaling: {
    key: 'rope_scaling',
    title: 'RoPE Scaling Method',
    description: 'RoPE frequency scaling method.',
    controller_type: 'dropdown',
    controller_props: {
      value: 'none',
      options: [
        { value: 'none', name: 'None' },
        { value: 'linear', name: 'Linear' },
        { value: 'yarn', name: 'YaRN' },
      ],
    },
  },
  rope_scale: {
    key: 'rope_scale',
    title: 'RoPE Scale Factor',
    description: 'RoPE context scaling factor.',
    controller_type: 'input',
    controller_props: {
      value: 1.0,
      placeholder: '1.0',
      type: 'number',
      min: 0,
      step: 0.01,
    },
  },
  rope_freq_base: {
    key: 'rope_freq_base',
    title: 'RoPE Frequency Base',
    description: 'RoPE base frequency (0 = loaded from model).',
    controller_type: 'input',
    controller_props: {
      value: 0,
      placeholder: '0 (model default)',
      type: 'number',
    },
  },
  rope_freq_scale: {
    key: 'rope_freq_scale',
    title: 'RoPE Frequency Scale Factor',
    description: 'RoPE frequency scaling factor.',
    controller_type: 'input',
    controller_props: {
      value: 1.0,
      placeholder: '1.0',
      type: 'number',
      min: 0,
      step: 0.01,
    },
  },
  temp: {
    key: 'temp',
    title: 'Temperature',
    description: 'Temperature for sampling (higher = more random).',
    controller_type: 'input',
    controller_props: {
      value: 0.8,
      placeholder: '0.8',
      type: 'number',
      min: 0,
      step: 0.01,
    },
  },
  top_k: {
    key: 'top_k',
    title: 'Top K',
    description: 'Top-K sampling (0 = disabled).',
    controller_type: 'input',
    controller_props: {
      value: 40,
      placeholder: '40',
      type: 'number',
      min: 0,
    },
  },
  top_p: {
    title: 'Top P',
    description: 'Top-P sampling (1.0 = disabled).',
    controller_type: 'input',
    controller_props: {
      value: 0.9,
      placeholder: '0.9',
      type: 'number',
      min: 0,
      max: 1.0,
      step: 0.01,
    },
  },
  min_p: {
    key: 'min_p',
    title: 'Min P',
    description: 'Min-P sampling (0.0 = disabled).',
    controller_type: 'input',
    controller_props: {
      value: 0.1,
      placeholder: '0.1',
      type: 'number',
      min: 0,
      max: 1.0,
      step: 0.01,
    },
  },
  repeat_last_n: {
    key: 'repeat_last_n',
    title: 'Repeat Last N',
    description:
      'Number of tokens to consider for repeat penalty (0 = disabled, -1 = ctx_size).',
    controller_type: 'input',
    controller_props: {
      value: 64,
      placeholder: '64',
      type: 'number',
      min: -1,
    },
  },
  repeat_penalty: {
    key: 'repeat_penalty',
    title: 'Repeat Penalty',
    description: 'Penalize repeating token sequences (1.0 = disabled).',
    controller_type: 'input',
    controller_props: {
      value: 1.0,
      placeholder: '1.0',
      type: 'number',
      min: 0,
      step: 0.01,
    },
  },
  presence_penalty: {
    key: 'presence_penalty',
    title: 'Presence Penalty',
    description: 'Repeat alpha presence penalty (0.0 = disabled).',
    controller_type: 'input',
    controller_props: {
      value: 0.0,
      placeholder: '0.0',
      type: 'number',
      min: 0,
      step: 0.01,
    },
  },
  frequency_penalty: {
    key: 'frequency_penalty',
    title: 'Frequency Penalty',
    description: 'Repeat alpha frequency penalty (0.0 = disabled).',
    controller_type: 'input',
    controller_props: {
      value: 0.0,
      placeholder: '0.0',
      type: 'number',
      min: 0,
      step: 0.01,
    },
  },
  mirostat: {
    key: 'mirostat',
    title: 'Mirostat Mode',
    description:
      'Use Mirostat sampling (0: disabled, 1: Mirostat V1, 2: Mirostat V2).',
    controller_type: 'dropdown',
    controller_props: {
      value: 0,
      options: [
        { value: 0, name: 'Disabled' },
        { value: 1, name: 'Mirostat V1' },
        { value: 2, name: 'Mirostat V2' },
      ],
    },
  },
  mirostat_lr: {
    key: 'mirostat_lr',
    title: 'Mirostat Learning Rate',
    description: 'Mirostat learning rate (eta).',
    controller_type: 'input',
    controller_props: {
      value: 0.1,
      placeholder: '0.1',
      type: 'number',
      min: 0,
      step: 0.01,
    },
  },
  mirostat_ent: {
    key: 'mirostat_ent',
    title: 'Mirostat Target Entropy',
    description: 'Mirostat target entropy (tau).',
    controller_type: 'input',
    controller_props: {
      value: 5.0,
      placeholder: '5.0',
      type: 'number',
      min: 0,
      step: 0.01,
    },
  },
  grammar_file: {
    key: 'grammar_file',
    title: 'Grammar File',
    description: 'Path to a BNF-like grammar file to constrain generations.',
    controller_type: 'input',
    controller_props: {
      value: '',
      placeholder: 'path/to/grammar.gbnf',
      type: 'text',
    },
  },
  json_schema_file: {
    key: 'json_schema_file',
    title: 'JSON Schema File',
    description: 'Path to a JSON schema file to constrain generations.',
    controller_type: 'input',
    controller_props: {
      value: '',
      placeholder: 'path/to/schema.json',
      type: 'text',
    },
  },
}
