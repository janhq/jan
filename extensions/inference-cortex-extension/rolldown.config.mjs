import { defineConfig } from 'rolldown'
import packageJson from './package.json' with { type: 'json' }
import defaultSettingJson from './resources/default_settings.json' with { type: 'json' }
import bakllavaJson from './resources/models/bakllava-1/model.json' with { type: 'json' }
import codeninja7bJson from './resources/models/codeninja-1.0-7b/model.json' with { type: 'json' }
import commandr34bJson from './resources/models/command-r-34b/model.json' with { type: 'json' }
import deepseekCoder13bJson from './resources/models/deepseek-coder-1.3b/model.json' with { type: 'json' }
import deepseekCoder34bJson from './resources/models/deepseek-coder-34b/model.json' with { type: 'json' }
import gemma112bJson from './resources/models/gemma-1.1-2b/model.json' with { type: 'json' }
import gemma117bJson from './resources/models/gemma-1.1-7b/model.json' with { type: 'json' }
import llama2Chat70bJson from './resources/models/llama2-chat-70b/model.json' with { type: 'json' }
import llama2Chat7bJson from './resources/models/llama2-chat-7b/model.json' with { type: 'json' }
import llamacorn1bJson from './resources/models/llamacorn-1.1b/model.json' with { type: 'json' }
import llava13bJson from './resources/models/llava-13b/model.json' with { type: 'json' }
import llava7bJson from './resources/models/llava-7b/model.json' with { type: 'json' }
import mistralIns7bq4Json from './resources/models/mistral-ins-7b-q4/model.json' with { type: 'json' }
import mixtral8x7bInstructJson from './resources/models/mixtral-8x7b-instruct/model.json' with { type: 'json' }
import noromaid7bJson from './resources/models/noromaid-7b/model.json' with { type: 'json' }
import openchat357bJson from './resources/models/openchat-3.5-7b/model.json' with { type: 'json' }
import phi3bJson from './resources/models/phi3-3.8b/model.json' with { type: 'json' }
import phind34bJson from './resources/models/phind-34b/model.json' with { type: 'json' }
import qwen7bJson from './resources/models/qwen-7b/model.json' with { type: 'json' }
import stableZephyr3bJson from './resources/models/stable-zephyr-3b/model.json' with { type: 'json' }
import stealthv127bJson from './resources/models/stealth-v1.2-7b/model.json' with { type: 'json' }
import tinyllama11bJson from './resources/models/tinyllama-1.1b/model.json' with { type: 'json' }
import trinityv127bJson from './resources/models/trinity-v1.2-7b/model.json' with { type: 'json' }
import vistral7bJson from './resources/models/vistral-7b/model.json' with { type: 'json' }
import wizardcoder13bJson from './resources/models/wizardcoder-13b/model.json' with { type: 'json' }
import yi34bJson from './resources/models/yi-34b/model.json' with { type: 'json' }
import llama3Json from './resources/models/llama3-8b-instruct/model.json' with { type: 'json' }
import llama3Hermes8bJson from './resources/models/llama3-hermes-8b/model.json' with { type: 'json' }
import aya8bJson from './resources/models/aya-23-8b/model.json' with { type: 'json' }
import aya35bJson from './resources/models/aya-23-35b/model.json' with { type: 'json' }
import phimediumJson from './resources/models/phi3-medium/model.json' with { type: 'json' }
import codestralJson from './resources/models/codestral-22b/model.json' with { type: 'json' }
import qwen2Json from './resources/models/qwen2-7b/model.json' with { type: 'json' }
import llama318bJson from './resources/models/llama3.1-8b-instruct/model.json' with { type: 'json' }
import llama3170bJson from './resources/models/llama3.1-70b-instruct/model.json' with { type: 'json' }
import gemma22bJson from './resources/models/gemma-2-2b/model.json' with { type: 'json' }
import gemma29bJson from './resources/models/gemma-2-9b/model.json' with { type: 'json' }
import gemma227bJson from './resources/models/gemma-2-27b/model.json' with { type: 'json' }
import llama321bJson from './resources/models/llama3.2-1b-instruct/model.json' with { type: 'json' }
import llama323bJson from './resources/models/llama3.2-3b-instruct/model.json' with { type: 'json' }
import qwen257bJson from './resources/models/qwen2.5-7b-instruct/model.json' with { type: 'json' }
import qwen25coder7bJson from './resources/models/qwen2.5-coder-7b-instruct/model.json' with { type: 'json' }
import qwen25coder14bJson from './resources/models/qwen2.5-coder-14b-instruct/model.json' with { type: 'json' }
import qwen25coder32bJson from './resources/models/qwen2.5-coder-32b-instruct/model.json' with { type: 'json' }
import qwen2514bJson from './resources/models/qwen2.5-14b-instruct/model.json' with { type: 'json' }
import qwen2532bJson from './resources/models/qwen2.5-32b-instruct/model.json' with { type: 'json' }
import qwen2572bJson from './resources/models/qwen2.5-72b-instruct/model.json' with { type: 'json' }

export default defineConfig([
  {
    input: 'src/index.ts',
    output: {
      format: 'esm',
      file: 'dist/index.js',
    },
    platform: 'browser',
    define: {
      MODELS: JSON.stringify([
        bakllavaJson,
        codeninja7bJson,
        commandr34bJson,
        deepseekCoder13bJson,
        deepseekCoder34bJson,
        gemma112bJson,
        gemma117bJson,
        llama2Chat70bJson,
        llama2Chat7bJson,
        llamacorn1bJson,
        llava13bJson,
        llava7bJson,
        mistralIns7bq4Json,
        mixtral8x7bInstructJson,
        noromaid7bJson,
        openchat357bJson,
        phi3bJson,
        phind34bJson,
        qwen7bJson,
        stableZephyr3bJson,
        stealthv127bJson,
        tinyllama11bJson,
        trinityv127bJson,
        vistral7bJson,
        wizardcoder13bJson,
        yi34bJson,
        llama3Json,
        llama3Hermes8bJson,
        phimediumJson,
        aya8bJson,
        aya35bJson,
        codestralJson,
        qwen2Json,
        llama318bJson,
        llama3170bJson,
        gemma22bJson,
        gemma29bJson,
        gemma227bJson,
        llama321bJson,
        llama323bJson,
        qwen257bJson,
        qwen25coder7bJson,
        qwen25coder14bJson,
        qwen25coder32bJson,
        qwen2514bJson,
        qwen2532bJson,
        qwen2572bJson,
      ]),
      NODE: JSON.stringify(`${packageJson.name}/${packageJson.node}`),
      SETTINGS: JSON.stringify(defaultSettingJson),
      CORTEX_API_URL: JSON.stringify('http://127.0.0.1:39291'),
      CORTEX_SOCKET_URL: JSON.stringify('ws://127.0.0.1:39291'),
      CORTEX_ENGINE_VERSION: JSON.stringify('v0.1.46'),
    },
  },
  {
    input: 'src/node/index.ts',
    external: ['@janhq/core/node', 'cpu-instructions'],
    output: {
      format: 'cjs',
      file: 'dist/node/index.cjs.js',
      sourcemap: false,
      inlineDynamicImports: true,
    },
    resolve: {
      extensions: ['.js', '.ts', '.json'],
    },
    platform: 'node',
  },
])
