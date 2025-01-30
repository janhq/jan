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
      API_URL: JSON.stringify('http://127.0.0.1:39291'),
      SOCKET_URL: JSON.stringify('ws://127.0.0.1:39291'),
      CORTEX_ENGINE_VERSION: JSON.stringify('v0.1.49'),
      DEFAULT_REMOTE_ENGINES: JSON.stringify(engines),
      DEFAULT_REMOTE_MODELS: JSON.stringify(models),
      DEFAULT_REQUEST_PAYLOAD_TRANSFORM: JSON.stringify('{{ tojson(value) }}'),
      DEFAULT_RESPONSE_BODY_TRANSFORM: JSON.stringify(
        '{ {% set first = true %} {% for key, value in input_request %} {% if key == "choices" or key == "created" or key == "model" or key == "service_tier" or key == "stream" or key == "object" or key == "usage" %} {% if not first %},{% endif %} "{{ key }}": {{ tojson(value) }} {% set first = false %} {% endif %} {% endfor %} }'
      ),
      DEFAULT_REQUEST_HEADERS_TRANSFORM: JSON.stringify(
        'Authorization: Bearer {{api_key}}'
      ),
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
      CORTEX_ENGINE_VERSION: JSON.stringify('v0.1.49'),
    },
  },
  {
    input: 'src/node/cpuInfo.ts',
    output: {
      format: 'cjs',
      file: 'dist/node/cpuInfo.js',
    },
    external: ['cpu-instructions'],
    resolve: {
      extensions: ['.ts', '.js', '.svg'],
    },
  },
])
