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
      placeholder: '100',
      type: 'number',
    },
  },
  temperature: {
    key: 'temperature',
    title: 'Temperature',
    description:
      'Temperature for sampling (higher = more random). This is the default setting on load and can be overridden by the assistant settings.',
    controller_type: 'input',
    controller_props: {
      value: '',
      placeholder: '0.6',
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
      value: '',
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
      value: '',
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
      value: '',
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
      value: '',
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
      value: '',
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
      value: '',
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
      value: '',
      placeholder: '0.0',
      type: 'number',
    },
  },
  chatTemplate: {
    key: 'chat_template',
    title: 'Custom Jinja Chat template',
    description: 'Custom Jinja chat_template to be used for the model',
    controller_type: 'textarea',
    controller_props: {
      value: '',
      placeholder:
        'e.g., {% for message in messages %}...{% endfor %} (default is read from GGUF)',
      type: 'text',
      textAlign: 'right',
    },
  },
  cpu_moe: {
    key: 'cpu_moe',
    title: 'Keep all Experts in CPU',
    description:
      'Keep all Mixture of Experts (MoE) weights in the CPU (if GPU is used).',
    controller_type: 'checkbox',
    controller_props: {
      value: false,
    },
  },
  n_cpu_moe: {
    key: 'n_cpu_moe',
    title: 'Number of MoE weights in the CPU',
    description:
      'Keep the Mixture of Experts (MoE) weights of the first N layers in the CPU (if GPU is used)',
    controller_type: 'input',
    controller_props: {
      value: '',
      placeholder: '24',
      type: 'number',
    },
  },
  override_tensor_buffer_t: {
    key: 'override_tensor_buffer_t',
    title: 'Override Tensor Buffer Type',
    description: 'Override the tensor buffer type for the model',
    controller_type: 'input',
    controller_props: {
      value: '',
      placeholder: 'e.g., layers\\.\\d+\\.ffn_.*=CPU',
      type: 'text',
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
  batch_size: {
    key: 'batch_size',
    title: 'Batch Size',
    description: 'Logical maximum batch size for processing prompts.',
    controller_type: 'input',
    controller_props: {
      value: 2048,
      placeholder: '2048',
      type: 'number',
      textAlign: 'right',
    },
  },
}
