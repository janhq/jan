import { defineConfig } from 'rolldown'
import { engines, models } from './engines.mjs'
import pkgJson from './package.json' with { type: 'json' }

export default defineConfig([
  {
    input: 'src/index.ts',
    output: {
      format: 'esm',
      file: 'dist/index.js',
    },
    define: {
      NODE: JSON.stringify(`${pkgJson.name}/${pkgJson.node}`),
      API_URL: JSON.stringify(
        `http://127.0.0.1:${process.env.CORTEX_API_PORT ?? '39291'}`
      ),
      PLATFORM: JSON.stringify(process.platform),
      CORTEX_ENGINE_VERSION: JSON.stringify('v0.1.54'),
      DEFAULT_REMOTE_ENGINES: JSON.stringify(engines),
      DEFAULT_REMOTE_MODELS: JSON.stringify(models),
      DEFAULT_REQUEST_PAYLOAD_TRANSFORM: JSON.stringify(
        `{ {% set first = true %} {% for key, value in input_request %} {% if key == "messages" or key == "model" or key == "temperature" or key == "store" or key == "max_tokens" or key == "stream" or key == "presence_penalty" or key == "metadata" or key == "frequency_penalty" or key == "tools" or key == "tool_choice" or key == "logprobs" or key == "top_logprobs" or key == "logit_bias" or key == "n" or key == "modalities" or key == "prediction" or key == "response_format" or key == "service_tier" or key == "seed" or key == "stop" or key == "stream_options" or key == "top_p" or key == "parallel_tool_calls" or key == "user" %} {% if not first %},{% endif %} "{{ key }}": {{ tojson(value) }} {% set first = false %} {% endif %} {% endfor %} }`
      ),
      DEFAULT_RESPONSE_BODY_TRANSFORM: JSON.stringify(
        '{{tojson(input_request)}}'
      ),
      DEFAULT_REQUEST_HEADERS_TRANSFORM: JSON.stringify(
        'Authorization: Bearer {{api_key}}'
      ),
      VERSION: JSON.stringify(pkgJson.version ?? '0.0.0'),
    },
  },
  {
    input: 'src/node/index.ts',
    external: ['@janhq/core/node'],
    output: {
      format: 'cjs',
      file: 'dist/node/index.cjs.js',
    },
    define: {
      CORTEX_ENGINE_VERSION: JSON.stringify('v0.1.54'),
    },
  },
])
