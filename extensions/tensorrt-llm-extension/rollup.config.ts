import resolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import sourceMaps from 'rollup-plugin-sourcemaps'
import typescript from 'rollup-plugin-typescript2'
import json from '@rollup/plugin-json'
import replace from '@rollup/plugin-replace'
const packageJson = require('./package.json')
const modelsJson = require('./resources/models.json')

export default [
  {
    input: `src/index.ts`,
    output: [{ file: packageJson.main, format: 'es', sourcemap: true }],
    watch: {
      include: 'src/**',
    },
    plugins: [
      replace({
        MODELS: JSON.stringify(modelsJson),
        EXTENSION_NAME: JSON.stringify(packageJson.name),
        TENSORRT_VERSION: JSON.stringify(packageJson.tensorrtVersion),
        PROVIDER: JSON.stringify(packageJson.provider),
        DOWNLOAD_RUNNER_URL:
          process.platform === 'win32'
            ? JSON.stringify(
                'https://github.com/janhq/nitro-tensorrt-llm/releases/download/windows-v<version>-tensorrt-llm-v0.7.1/nitro-windows-v<version>-tensorrt-llm-v0.7.1-amd64-all-arch.tar.gz'
              )
            : JSON.stringify(
                'https://github.com/janhq/nitro-tensorrt-llm/releases/download/linux-v<version>/nitro-linux-v<version>-amd64-tensorrt-llm-<gpuarch>.tar.gz'
              ),
        NODE: JSON.stringify(`${packageJson.name}/${packageJson.node}`),
        INFERENCE_URL: JSON.stringify(
          process.env.INFERENCE_URL ||
            `${packageJson.config?.protocol ?? 'http'}://${packageJson.config?.host}:${packageJson.config?.port}/v1/chat/completions`
        ),
        COMPATIBILITY: JSON.stringify(packageJson.compatibility),
      }),
      json(),
      typescript({ useTsconfigDeclarationDir: true }),
      commonjs(),
      resolve({
        extensions: ['.js', '.ts', '.svelte'],
      }),
      sourceMaps(),
    ],
  },
  {
    input: `src/node/index.ts`,
    output: [
      { file: 'dist/node/index.cjs.js', format: 'cjs', sourcemap: true },
    ],
    external: ['@janhq/core/node'],
    watch: {
      include: 'src/node/**',
    },
    plugins: [
      replace({
        EXTENSION_NAME: JSON.stringify(packageJson.name),
        TENSORRT_VERSION: JSON.stringify(packageJson.tensorrtVersion),
        PROVIDER: JSON.stringify(packageJson.provider),
        LOAD_MODEL_URL: JSON.stringify(
          `${packageJson.config?.protocol ?? 'http'}://${packageJson.config?.host}:${packageJson.config?.port}/inferences/tensorrtllm/loadmodel`
        ),
        TERMINATE_ENGINE_URL: JSON.stringify(
          `${packageJson.config?.protocol ?? 'http'}://${packageJson.config?.host}:${packageJson.config?.port}/processmanager/destroy`
        ),
        ENGINE_HOST: JSON.stringify(packageJson.config?.host ?? '127.0.0.1'),
        ENGINE_PORT: JSON.stringify(packageJson.config?.port ?? '3928'),
      }),
      json(),
      typescript({ useTsconfigDeclarationDir: true }),
      commonjs(),
      resolve({
        extensions: ['.ts', '.js', '.json'],
      }),
      sourceMaps(),
    ],
  },
]
