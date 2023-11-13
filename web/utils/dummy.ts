/* eslint-disable @typescript-eslint/naming-convention */
import { ModelCatalog, ModelVersion } from '@janhq/core'

export const dummyModel: ModelCatalog = {
  id: 'aladar/TinyLLama-v0-GGUF',
  name: 'TinyLLama-v0-GGUF',
  shortDescription: 'TinyLlama-1.1B-Chat-v0.3-GGUF',
  longDescription: 'https://huggingface.co/aladar/TinyLLama-v0-GGUF/tree/main',
  avatarUrl: '',
  status: '',
  releaseDate: Date.now(),
  author: 'aladar',
  version: '1.0.0',
  modelUrl: 'aladar/TinyLLama-v0-GGUF',
  tags: ['freeform', 'tags'],
  createdAt: 0,
  availableVersions: [
    {
      id: 'tinyllama-1.1b-chat-v0.3.Q2_K.gguf',
      name: 'tinyllama-1.1b-chat-v0.3.Q2_K.gguf',
      quantMethod: '',
      bits: 2,
      size: 19660000,
      maxRamRequired: 256000000,
      usecase:
        'smallest, significant quality loss - not recommended for most purposes',
      downloadLink:
        'https://huggingface.co/aladar/TinyLLama-v0-GGUF/resolve/main/TinyLLama-v0.f32.gguf',
    } as ModelVersion,
  ],
}
