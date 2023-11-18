/* eslint-disable @typescript-eslint/naming-convention */
import { ModelCatalog, ModelVersion } from '@janhq/core'

export const dummyModel: ModelCatalog = {
  id: 'aladar/TinyLLama-v0-GGUF',
  name: 'TinyLLama-v0-GGUF',
  shortDescription: 'TinyLlama-1.1B-Chat-v0.3-GGUF',
  longDescription: 'https://huggingface.co/aladar/TinyLLama-v0-GGUF/tree/main',
  avatarUrl: '',
  releaseDate: Date.now(),
  author: 'aladar',
  version: '1.0.0',
  modelUrl: 'aladar/TinyLLama-v0-GGUF',
  tags: ['freeform', 'tags'],
  availableVersions: [
    {
      name: 'TinyLLama-v0.Q8_0.gguf',
      quantizationName: '',
      bits: 2,
      size: 5816320,
      maxRamRequired: 256000000,
      usecase:
        'smallest, significant quality loss - not recommended for most purposes',
      downloadLink:
        'https://huggingface.co/aladar/TinyLLama-v0-GGUF/resolve/main/TinyLLama-v0.Q8_0.gguf',
    },
    {
      name: 'TinyLLama-v0.f16.gguf',
      quantizationName: '',
      bits: 2,
      size: 10240000,
      maxRamRequired: 256000000,
      usecase:
        'smallest, significant quality loss - not recommended for most purposes',
      downloadLink:
        'https://huggingface.co/aladar/TinyLLama-v0-GGUF/resolve/main/TinyLLama-v0.f16.gguf',
    },
    {
      name: 'TinyLLama-v0.f32.gguf',
      quantizationName: '',
      bits: 2,
      size: 19660000,
      maxRamRequired: 256000000,
      usecase:
        'smallest, significant quality loss - not recommended for most purposes',
      downloadLink:
        'https://huggingface.co/aladar/TinyLLama-v0-GGUF/resolve/main/TinyLLama-v0.f32.gguf',
    },
  ],
}
