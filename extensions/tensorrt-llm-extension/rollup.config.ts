import resolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import sourceMaps from 'rollup-plugin-sourcemaps'
import typescript from 'rollup-plugin-typescript2'
import json from '@rollup/plugin-json'
import replace from '@rollup/plugin-replace'
const packageJson = require('./package.json')

const pkg = require('./package.json')

export default [
  {
    input: `src/index.ts`,
    output: [{ file: pkg.main, format: 'es', sourcemap: true }],
    watch: {
      include: 'src/**',
    },
    plugins: [
      replace({
        TENSORRT_VERSION: JSON.stringify('0.1.0'),
        DOWNLOAD_RUNNER_URL:
          process.platform === 'darwin' || process.platform === 'win32'
            ? JSON.stringify(
                'https://github.com/janhq/nitro-tensorrt-llm/releases/download/windows-v<version>/nitro-windows-v<version>-amd64-tensorrt-llm-<gpuarch>.tar.gz'
              )
            : JSON.stringify('https://jan.ai'), // TODO: add for linux later
        NODE: JSON.stringify(`${packageJson.name}/${packageJson.node}`),
        INFERENCE_URL: JSON.stringify(
          process.env.INFERENCE_URL ||
            `${packageJson.config?.protocol ?? 'http'}://${packageJson.config?.host}:${packageJson.config?.port}/v1/chat/completions`
        ),
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
        LOAD_MODEL_URL: JSON.stringify(
          `${packageJson.config?.protocol ?? 'http'}://${packageJson.config?.host}:${packageJson.config?.port}/inferences/tensorrtllm/loadmodel`
        ),
        TERMINATE_ENGINE_URL: JSON.stringify(
          `${packageJson.config?.protocol ?? 'http'}://${packageJson.config?.host}:${packageJson.config?.port}/inferences/processmanager/destroy`
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
