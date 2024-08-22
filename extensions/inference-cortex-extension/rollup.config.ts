import resolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import sourceMaps from 'rollup-plugin-sourcemaps'
import typescript from 'rollup-plugin-typescript2'
import json from '@rollup/plugin-json'
import replace from '@rollup/plugin-replace'
const hf = require('./helpers/huggingface.js')
const packageJson = require('./package.json')
const defaultSettingJson = require('./resources/default_settings.json')

export default async () => [
  {
    input: 'src/index.ts',
    output: [{ file: packageJson.main, format: 'es', sourcemap: true }],
    // Indicate here external modules you don't wanna include in your bundle (i.e.: 'lodash')
    external: [],
    watch: {
      include: 'src/**',
    },
    plugins: [
      replace({
        preventAssignment: true,
        MODELS: JSON.stringify(await hf.fetchCortexHubModels()),
        NODE: JSON.stringify(`${packageJson.name}/${packageJson.node}`),
        DEFAULT_SETTINGS: JSON.stringify(defaultSettingJson),
        INFERENCE_URL: JSON.stringify(
          process.env.INFERENCE_URL ||
            'http://127.0.0.1:3941/inferences/server/chat_completion'
        ),
        TROUBLESHOOTING_URL: JSON.stringify(
          'https://jan.ai/guides/troubleshooting'
        ),
      }),
      // Allow json resolution
      json(),
      //     Compile TypeScript files
      typescript({ useTsconfigDeclarationDir: true }),
      // Compile TypeScript files
      // Allow bundling cjs modules (unlike webpack, rollup doesn't understand cjs)
      commonjs(),
      // Allow node_modules resolution, so you can use 'external' to control
      // which external modules to include in the bundle
      // https://github.com/rollup/rollup-plugin-node-resolve#usage
      resolve({
        extensions: ['.js', '.ts', '.svelte'],
        browser: true,
      }),

      // Resolve source maps to the original source
      sourceMaps(),
    ],
  },
  {
    input: `src/node/index.ts`,
    output: [
      { file: 'dist/node/index.cjs.js', format: 'cjs', sourcemap: false},
    ],
    // Indicate here external modules you don't wanna include in your bundle (i.e.: 'lodash')
    external: ['@janhq/core/node', 'cortexso', '@janhq/core', 'sqlite3'],
    watch: {
      include: 'src/node/**',
    },
    inlineDynamicImports: true,
    plugins: [
      // Allow json resolution
      json(),
      // Compile TypeScript files
      typescript({ useTsconfigDeclarationDir: true }),
      resolve({
        extensions: ['.ts', '.js', '.json', '.mjs', '.js', '.json', '.node'],
      }),
      // Allow bundling cjs modules (unlike webpack, rollup doesn't understand cjs)
      commonjs(),
      // Allow node_modules resolution, so you can use 'external' to control
      // which external modules to include in the bundle
      // https://github.com/rollup/rollup-plugin-node-resolve#usage
      // Resolve source maps to the original source
      sourceMaps(),
    ],
  },
]
