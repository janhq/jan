import { defineConfig } from 'rolldown'
import packageJson from './package.json' with { type: 'json' }
import modelsJson from './resources/models.json' with { type: 'json' }

export default defineConfig([
  {
    input: 'src/index.ts',
    output: {
      format: 'esm',
      file: 'dist/index.js',
    },
    platform: 'browser',
    define: {
      MODELS: JSON.stringify(modelsJson),
      TENSORRT_VERSION: JSON.stringify(packageJson.tensorrtVersion),
      PROVIDER: JSON.stringify(packageJson.provider),
      DOWNLOAD_RUNNER_URL:
        process.platform === 'win32'
          ? JSON.stringify(
              'https://github.com/janhq/cortex.tensorrt-llm/releases/download/windows-v<version>-tensorrt-llm-v0.7.1/nitro-windows-v<version>-tensorrt-llm-v0.7.1-amd64-all-arch.tar.gz'
            )
          : JSON.stringify(
              'https://github.com/janhq/cortex.tensorrt-llm/releases/download/linux-v<version>/nitro-linux-v<version>-amd64-tensorrt-llm-<gpuarch>.tar.gz'
            ),
      NODE: JSON.stringify(`${packageJson.name}/${packageJson.node}`),
      INFERENCE_URL: JSON.stringify(
        process.env.INFERENCE_URL ||
          `${packageJson.config?.protocol ?? 'http'}://${packageJson.config?.host}:${packageJson.config?.port}/v1/chat/completions`
      ),
      COMPATIBILITY: JSON.stringify(packageJson.compatibility),
    },
  },
  {
    input: 'src/node/index.ts',
    external: ['@janhq/core/node'],
    output: {
      format: 'cjs',
      file: 'dist/node/index.cjs.js',
      sourcemap: false,
      inlineDynamicImports: true,
    },
    replace: {
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
    },
    resolve: {
      extensions: ['.js', '.ts', '.json'],
    },
    platform: 'node',
  },
])
