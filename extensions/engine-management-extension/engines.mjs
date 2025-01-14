import anthropic from './resources/anthropic.json' with { type: 'json' }
import cohere from './resources/cohere.json' with { type: 'json' }
import openai from './resources/openai.json' with { type: 'json' }
import openrouter from './resources/openrouter.json' with { type: 'json' }
import groq from './resources/groq.json' with { type: 'json' }
import martian from './resources/martian.json' with { type: 'json' }
import mistral from './resources/mistral.json' with { type: 'json' }
import nvidia from './resources/nvidia.json' with { type: 'json' }

import anthropicModels from './models/anthropic.json' with { type: 'json' }
import cohereModels from './models/cohere.json' with { type: 'json' }
import openaiModels from './models/openai.json' with { type: 'json' }
import openrouterModels from './models/openrouter.json' with { type: 'json' }
import groqModels from './models/groq.json' with { type: 'json' }
import martianModels from './models/martian.json' with { type: 'json' }
import mistralModels from './models/mistral.json' with { type: 'json' }
import nvidiaModels from './models/nvidia.json' with { type: 'json' }

const engines = [
  anthropic,
  openai,
  cohere,
  openrouter,
  groq,
  mistral,
  martian,
  nvidia,
]
const models = [
  ...anthropicModels,
  ...openaiModels,
  ...cohereModels,
  ...openrouterModels,
  ...groqModels,
  ...mistralModels,
  ...martianModels,
  ...nvidiaModels,
]
export { engines, models }
