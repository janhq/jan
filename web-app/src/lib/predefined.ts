export const modelSettings = {
  ctx_len: {
    key: 'ctx_len',
    title: 'Context Size',
    description: 'Size of the prompt context (0 = loaded from model).',
    controller_type: 'input',
    controller_props: {
      value: 8192,
      placeholder: '8192',
      type: 'number',
    },
  },
  ngl: {
    key: 'ngl',
    title: 'GPU Layers',
    description:
      'Number of model layers to offload to the GPU (-1 for all layers, 0 for CPU only).',
    controller_type: 'input',
    controller_props: {
      value: 100,
      placeholder: '-1',
      type: 'number',
    },
  },

  temperature: {
    key: 'temp',
    title: 'Temperature',
    description:
      'Temperature for sampling (higher = more random). This is the default setting on load and can be overridden by the assistant settings.',
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
    description:
      'Top-K sampling (0 = disabled). This is the default setting on load and can be overridden by the assistant settings.',
    controller_type: 'input',
    controller_props: {
      value: 40,
      placeholder: '40',
      type: 'number',
    },
  },
  top_p: {
    key: 'top_p',
    title: 'Top P',
    description:
      'Top-P sampling (1.0 = disabled). This is the default setting on load and can be overridden by the assistant settings.',
    controller_type: 'input',
    controller_props: {
      value: 0.9,
      placeholder: '0.9',
      type: 'number',
    },
  },
  min_p: {
    key: 'min_p',
    title: 'Min P',
    description:
      'Min-P sampling (0.0 = disabled). This is the default setting on load and can be overridden by the assistant settings.',
    controller_type: 'input',
    controller_props: {
      value: 0.1,
      placeholder: '0.1',
      type: 'number',
    },
  },
  repeat_last_n: {
    key: 'repeat_last_n',
    title: 'Repeat Last N',
    description:
      'Number of tokens to consider for repeat penalty (0 = disabled, -1 = ctx_size). This is the default setting on load and can be overridden by the assistant settings.',
    controller_type: 'input',
    controller_props: {
      value: 64,
      placeholder: '64',
      type: 'number',
    },
  },
  repeat_penalty: {
    key: 'repeat_penalty',
    title: 'Repeat Penalty',
    description:
      'Penalize repeating token sequences (1.0 = disabled). This is the default setting on load and can be overridden by the assistant settings.',
    controller_type: 'input',
    controller_props: {
      value: 1.0,
      placeholder: '1.0',
      type: 'number',
    },
  },
  presence_penalty: {
    key: 'presence_penalty',
    title: 'Presence Penalty',
    description:
      'Repeat alpha presence penalty (0.0 = disabled). This is the default setting on load and can be overridden by the assistant settings.',
    controller_type: 'input',
    controller_props: {
      value: 0.0,
      placeholder: '0.0',
      type: 'number',
    },
  },
  frequency_penalty: {
    key: 'frequency_penalty',
    title: 'Frequency Penalty',
    description:
      'Repeat alpha frequency penalty (0.0 = disabled). This is the default setting on load and can be overridden by the assistant settings.',
    controller_type: 'input',
    controller_props: {
      value: 0.0,
      placeholder: '0.0',
      type: 'number',
    },
  },
}
