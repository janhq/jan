import { SettingComponentProps } from '@janhq/core/.'

export const presetConfiguration: Record<string, SettingComponentProps> = {
  prompt_template: {
    key: 'prompt_template',
    title: 'Prompt template',
    description: 'The prompt to use for internal configuration.',
    controllerType: 'input',
    controllerProps: {
      placeholder: 'Prompt template',
      value: '',
    },
    requireModelReload: true,
    configType: 'setting',
  },
  stop: {
    key: 'stop',
    title: 'Stop',
    description:
      'Defines specific tokens or phrases at which the model will stop generating further output.	',
    controllerType: 'input',
    controllerProps: {
      placeholder: 'Stop',
      value: '',
    },
    requireModelReload: false,
    configType: 'runtime',
  },
  ctx_len: {
    key: 'ctx_len',
    title: 'Context Length',
    description:
      'The context length for model operations varies; the maximum depends on the specific model used.',
    controllerType: 'slider',
    controllerProps: {
      min: 128,
      max: 4096,
      step: 128,
      value: 2048,
    },
    requireModelReload: true,
    configType: 'setting',
  },
  max_tokens: {
    key: 'max_tokens',
    title: 'Max Tokens',
    description:
      'The maximum number of tokens the model will generate in a single response.',
    controllerType: 'slider',
    controllerProps: {
      min: 100,
      max: 4096,
      step: 10,
      value: 4096,
    },
    requireModelReload: false,
    configType: 'runtime',
  },
  ngl: {
    key: 'ngl',
    title: 'Number of GPU layers (ngl)',
    description: 'The number of layers to load onto the GPU for acceleration.',
    controllerType: 'slider',
    controllerProps: {
      min: 1,
      max: 100,
      step: 1,
      value: 100,
    },
    requireModelReload: true,
    configType: 'setting',
  },
  embedding: {
    key: 'embedding',
    title: 'Embedding',
    description: 'Whether to enable embedding.',
    controllerType: 'checkbox',
    controllerProps: {
      value: true,
    },
    requireModelReload: true,
    configType: 'setting',
  },
  stream: {
    key: 'stream',
    title: 'Stream',
    description: 'Enable real-time data processing for faster predictions.',
    controllerType: 'checkbox',
    controllerProps: {
      value: false,
    },
    requireModelReload: false,
    configType: 'runtime',
  },
  temperature: {
    key: 'temperature',
    title: 'Temperature',
    description: 'Controls the randomness of the model’s output.',
    controllerType: 'slider',
    controllerProps: {
      min: 0,
      max: 2,
      step: 0.1,
      value: 0.7,
    },
    requireModelReload: false,
    configType: 'runtime',
  },
  frequency_penalty: {
    key: 'frequency_penalty',
    title: 'Frequency Penalty',
    description:
      'Adjusts the likelihood of the model repeating words or phrases in its output.	',
    controllerType: 'slider',
    controllerProps: {
      min: 0,
      max: 1,
      step: 0.1,
      value: 0.7,
    },
    requireModelReload: false,
    configType: 'runtime',
  },
  presence_penalty: {
    key: 'presence_penalty',
    title: 'Presence Penalty',
    description:
      'Influences the generation of new and varied concepts in the model’s output.	',
    controllerType: 'slider',
    controllerProps: {
      min: 0,
      max: 1,
      step: 0.1,
      value: 0.7,
    },
    requireModelReload: false,
    configType: 'runtime',
  },
  top_p: {
    key: 'top_p',
    title: 'Top P',
    description: 'Set probability threshold for more relevant outputs.',
    controllerType: 'slider',
    controllerProps: {
      min: 0,
      max: 1,
      step: 0.1,
      value: 0.95,
    },
    requireModelReload: false,
    configType: 'runtime',
  },
  n_parallel: {
    key: 'n_parallel',
    title: 'N Parallel',
    description:
      'The number of parallel operations. Only set when enable continuous batching.	',
    controllerType: 'slider',
    controllerProps: {
      min: 0,
      max: 4,
      step: 1,
      value: 1,
    },
    requireModelReload: true,
    configType: 'setting',
  },
  cpu_threads: {
    key: 'cpu_threads',
    title: 'CPU Threads',
    description:
      'Determines CPU inference threads, limited by hardware and OS. (Maximum determined by system)',
    controllerType: 'slider',
    controllerProps: {
      min: 0,
      max: 128,
      step: 1,
      value: 1,
    },
    requireModelReload: true,
    configType: 'setting',
  },
  // assistant
  chunk_size: {
    key: 'chunk_size',
    title: 'Chunk Size',
    description: 'Maximum number of tokens in a chunk',
    controllerType: 'slider',
    controllerProps: {
      min: 128,
      max: 2048,
      step: 128,
      value: 1024,
    },
    requireModelReload: true,
    configType: 'setting',
  },
  chunk_overlap: {
    key: 'chunk_overlap',
    title: 'Chunk Overlap',
    description: 'Number of tokens overlapping between two adjacent chunks',
    controllerType: 'slider',
    controllerProps: {
      min: 32,
      max: 512,
      step: 32,
      value: 64,
    },
    requireModelReload: true,
    configType: 'setting',
  },
  top_k: {
    key: 'top_k',
    title: 'Top K',
    description: 'Number of top-ranked documents to retrieve',
    controllerType: 'slider',
    controllerProps: {
      min: 1,
      max: 5,
      step: 1,
      value: 2,
    },
    requireModelReload: false,
    configType: 'runtime',
  },
  retrieval_template: {
    key: 'retrieval_template',
    title: 'Retrieval Template',
    description:
      'The template to use for retrieval. The following variables are available: {CONTEXT}, {QUESTION}',
    controllerType: 'input',
    controllerProps: {
      placeholder: 'Retrieval Template',
      value: '',
    },
    requireModelReload: true,
    configType: 'setting',
  },
}
