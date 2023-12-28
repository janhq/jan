import { SettingComponentData } from './settingComponentBuilder'

export const presetConfiguration: Record<string, SettingComponentData> = {
  prompt_template: {
    name: 'prompt_template',
    title: 'Prompt template',
    description: 'Prompt template',
    controllerType: 'input',
    controllerData: {
      placeholder: 'Prompt template',
      value: '',
    },
  },
  stop: {
    name: 'stop',
    title: 'Stop',
    description: 'Stop',
    controllerType: 'input',
    controllerData: {
      placeholder: 'Stop',
      value: '',
    },
  },
  ctx_len: {
    name: 'ctx_len',
    title: 'Context Length',
    description: 'Context Length',
    controllerType: 'slider',
    controllerData: {
      min: 0,
      max: 4096,
      step: 128,
      value: 1024,
    },
  },
  max_tokens: {
    name: 'max_tokens',
    title: 'Max Tokens',
    description:
      'The maximum number of tokens the model will generate in a single response.',
    controllerType: 'slider',
    controllerData: {
      min: 0,
      max: 4096,
      step: 128,
      value: 2048,
    },
  },
  ngl: {
    name: 'ngl',
    title: 'NGL',
    description: 'Number of layers in the neural network.',
    controllerType: 'slider',
    controllerData: {
      min: 1,
      max: 100,
      step: 1,
      value: 100,
    },
  },
  embedding: {
    name: 'embedding',
    title: 'Embedding',
    description: 'Indicates if embedding layers are used.',
    controllerType: 'checkbox',
    controllerData: {
      checked: true,
    },
  },
  stream: {
    name: 'stream',
    title: 'Stream',
    description: 'Stream',
    controllerType: 'checkbox',
    controllerData: {
      checked: false,
    },
  },
  temperature: {
    name: 'temperature',
    title: 'Temperature',
    description:
      "Controls randomness in model's responses. Higher values lead to more random responses.",
    controllerType: 'slider',
    controllerData: {
      min: 0,
      max: 2,
      step: 0.1,
      value: 0.7,
    },
  },
  frequency_penalty: {
    name: 'frequency_penalty',
    title: 'Frequency Penalty',
    description: 'Frequency Penalty',
    controllerType: 'slider',
    controllerData: {
      min: 0,
      max: 1,
      step: 0.1,
      value: 0.7,
    },
  },
  presence_penalty: {
    name: 'presence_penalty',
    title: 'Presence Penalty',
    description: 'Presence Penalty',
    controllerType: 'slider',
    controllerData: {
      min: 0,
      max: 1,
      step: 0.1,
      value: 0.7,
    },
  },
  top_p: {
    name: 'top_p',
    title: 'Top P',
    description: 'Top P',
    controllerType: 'slider',
    controllerData: {
      min: 0,
      max: 1,
      step: 0.1,
      value: 0.95,
    },
  },
  n_parallel: {
    name: 'n_parallel',
    title: 'N Parallel',
    description: 'N Parallel',
    controllerType: 'slider',
    controllerData: {
      min: 1,
      max: 4,
      step: 1,
      value: 1,
    },
  },
}
