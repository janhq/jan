import { SettingComponentData } from './settingComponentBuilder'

export const presetConfiguration: Record<string, SettingComponentData> = {
  max_tokens: {
    name: 'max_tokens',
    title: 'Max Tokens',
    description: 'Maximum context length the model can handle.',
    controllerType: 'slider',
    controllerData: {
      min: 0,
      max: 4096,
      step: 1,
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
}
