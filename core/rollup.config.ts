import resolve from 'rollup-plugin-node-resolve'
import commonjs from 'rollup-plugin-commonjs'
import sourceMaps from 'rollup-plugin-sourcemaps'
import typescript from 'rollup-plugin-typescript2'
import json from 'rollup-plugin-json'
import replace from '@rollup/plugin-replace'

const pkg = require('./package.json')

export default [
  {
    input: `src/index.ts`,
    output: [
      // { file: pkg.main, name: libraryName, format: 'umd', sourcemap: true },
      { file: pkg.main, format: 'es', sourcemap: true },
    ],
    // Indicate here external modules you don't wanna include in your bundle (i.e.: 'lodash')
    external: ['path'],
    watch: {
      include: 'src/**',
    },
    plugins: [
      // Allow json resolution
      json(),
      // Compile TypeScript files
      typescript({
        useTsconfigDeclarationDir: true,
        exclude: ['**/*.test.ts', 'src/node/**'],
      }),
      // Allow bundling cjs modules (unlike webpack, rollup doesn't understand cjs)
      // commonjs(),
      // Allow node_modules resolution, so you can use 'external' to control
      // which external modules to include in the bundle
      // https://github.com/rollup/rollup-plugin-node-resolve#usage
      replace({
        'preventAssignment': true,
        'node:crypto': 'crypto',
        'delimiters': ['"', '"'],
      }),
      resolve({
        browser: true,
      }),

      // Resolve source maps to the original source
      sourceMaps(),
    ],
  },
  {
    input: `src/node/index.ts`,
    output: [
      { file: 'dist/node/index.cjs.js', format: 'cjs', sourcemap: true },
    ],
    // Indicate here external modules you don't wanna include in your bundle (i.e.: 'lodash')
    external: [
      'fs/promises',
      'path',
      'pacote',
      '@types/pacote',
      '@npmcli/arborist',
      'ulidx',
      'node-fetch',
      'fs',
      'request',
      'crypto',
      'url',
      'http',
      'os',
      'util',
      'child_process',
    ],
    watch: {
      include: 'src/node/**',
    },
    plugins: [
      // Allow json resolution
      json(),
      // Compile TypeScript files
      typescript({
        useTsconfigDeclarationDir: true,
        exclude: ['**/*.test.ts', 'src/browser/**'],
      }),
      // Allow bundling cjs modules (unlike webpack, rollup doesn't understand cjs)
      commonjs(),
      // Allow node_modules resolution, so you can use 'external' to control
      // which external modules to include in the bundle
      // https://github.com/rollup/rollup-plugin-node-resolve#usage
      resolve(),

      // Resolve source maps to the original source
      sourceMaps(),
    ],
  },
]
