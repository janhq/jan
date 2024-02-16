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
    // Indicate here external modules you don't wanna include in your bundle (i.e.: 'lodash')
    external: [],
    watch: {
      include: 'src/**',
    },
    plugins: [
      replace({
        NODE: JSON.stringify(`${packageJson.name}/${packageJson.node}`),
        EXTENSION_NAME: JSON.stringify(packageJson.name),
        VERSION: JSON.stringify(packageJson.version),
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
      }),

      // Resolve source maps to the original source
      sourceMaps(),
    ],
  },
  {
    input: `src/node/index.ts`,
    output: [{ dir: 'dist/node', format: 'cjs', sourcemap: false }],
    // Indicate here external modules you don't wanna include in your bundle (i.e.: 'lodash')
    external: ['@janhq/core/node', 'path', 'hnswlib-node'],
    watch: {
      include: 'src/node/**',
    },
    // inlineDynamicImports: true,
    plugins: [
      // Allow json resolution
      json(),
      // Compile TypeScript files
      typescript({ useTsconfigDeclarationDir: true }),
      // Allow bundling cjs modules (unlike webpack, rollup doesn't understand cjs)
      commonjs({
        ignoreDynamicRequires: true,
      }),
      // Allow node_modules resolution, so you can use 'external' to control
      // which external modules to include in the bundle
      // https://github.com/rollup/rollup-plugin-node-resolve#usage
      resolve({
        extensions: ['.ts', '.js', '.json'],
      }),

      // Resolve source maps to the original source
      // sourceMaps(),
    ],
  },
]
