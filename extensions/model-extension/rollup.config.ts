import resolve from '@rollup/plugin-node-resolve'
import sourceMaps from 'rollup-plugin-sourcemaps'
import typescript from 'rollup-plugin-typescript2'
import json from '@rollup/plugin-json'
import replace from '@rollup/plugin-replace'
import commonjs from '@rollup/plugin-commonjs'
const settingJson = require('./resources/settings.json')
const packageJson = require('./package.json')

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
        SETTINGS: JSON.stringify(settingJson),
        API_URL: JSON.stringify('http://127.0.0.1:39291'),
        SOCKET_URL: JSON.stringify('ws://127.0.0.1:39291'),
      }),
      // Allow json resolution
      json(),
      //     Compile TypeScript files
      typescript({
        useTsconfigDeclarationDir: true,
        exclude: ['**/__tests__', '**/*.test.ts'],
      }),
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
]
