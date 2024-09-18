import resolve from '@rollup/plugin-node-resolve'
import sourceMaps from 'rollup-plugin-sourcemaps'
import typescript from 'rollup-plugin-typescript2'
import json from '@rollup/plugin-json'
import replace from '@rollup/plugin-replace'
import commonjs from '@rollup/plugin-commonjs'
const settingJson = require('./resources/settings.json')
const packageJson = require('./package.json')
const defaultModelJson = require('./resources/default-model.json')

export default [
  {
    input: `src/index.ts`,
    output: [{ file: packageJson.main, format: 'es', sourcemap: true }],
    // Indicate here external modules you don't wanna include in your bundle (i.e.: 'lodash')
    external: [],
    watch: {
      include: 'src/**',
    },
    plugins: [
      replace({
        preventAssignment: true,
        DEFAULT_MODEL: JSON.stringify(defaultModelJson),
        SETTINGS: JSON.stringify(settingJson),
        NODE: JSON.stringify(`${packageJson.name}/${packageJson.node}`),
      }),
      // Allow json resolution
      json(),
      //     Compile TypeScript files
      typescript({ useTsconfigDeclarationDir: true, exclude: ['**/__tests__', '**/*.test.ts'], }),
      // Compile TypeScript files
      // Allow bundling cjs modules (unlike webpack, rollup doesn't understand cjs)
      // commonjs(),
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
      {
        file: 'dist/node/index.cjs.js',
        format: 'cjs',
        sourcemap: true,
        inlineDynamicImports: true,
      },
    ],
    // Indicate here external modules you don't wanna include in your bundle (i.e.: 'lodash')
    external: ['@janhq/core/node'],
    watch: {
      include: 'src/node/**',
    },
    plugins: [
      // Allow json resolution
      json(),
      // Compile TypeScript files
      typescript({ useTsconfigDeclarationDir: true, exclude: ['**/__tests__', '**/*.test.ts'], }),
      // Allow bundling cjs modules (unlike webpack, rollup doesn't understand cjs)
      commonjs(),
      // Allow node_modules resolution, so you can use 'external' to control
      // which external modules to include in the bundle
      // https://github.com/rollup/rollup-plugin-node-resolve#usage
      resolve({
        extensions: ['.ts', '.js', '.json'],
      }),

      // Resolve source maps to the original source
      sourceMaps(),
    ],
  },
]
