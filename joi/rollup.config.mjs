import { readFileSync } from 'fs'
import dts from 'rollup-plugin-dts'
import terser from '@rollup/plugin-terser'
import autoprefixer from 'autoprefixer'
import commonjs from 'rollup-plugin-commonjs'
import bundleSize from 'rollup-plugin-bundle-size'
import peerDepsExternal from 'rollup-plugin-peer-deps-external'
import postcss from 'rollup-plugin-postcss'
import typescript from 'rollup-plugin-typescript2'
import tailwindcss from 'tailwindcss'
import typescriptEngine from 'typescript'
import resolve from '@rollup/plugin-node-resolve'
import copy from 'rollup-plugin-copy'

const packageJson = JSON.parse(readFileSync('./package.json'))

import tailwindConfig from './tailwind.config.js'

export default [
  {
    input: `./src/index.ts`,
    output: [
      {
        file: packageJson.main,
        format: 'es',
        exports: 'named',
        sourcemap: false,
      },
    ],
    external: ['react', 'typescript', 'class-variance-authority'],
    plugins: [
      postcss({
        plugins: [autoprefixer(), tailwindcss(tailwindConfig)],
        sourceMap: true,
        use: {
          sass: {
            silenceDeprecations: ['legacy-js-api'],
            api: 'modern',
          },
        },
        minimize: true,
        extract: 'main.css',
      }),

      peerDepsExternal({ includeDependencies: true }),
      commonjs(),
      resolve(),
      typescript({
        tsconfig: './tsconfig.json',
        typescript: typescriptEngine,
        sourceMap: false,
        exclude: [
          'docs',
          'dist',
          'node_modules/**',
          '**/*.test.ts',
          '**/*.test.tsx',
        ],
      }),
      terser(),
    ],
    watch: {
      clearScreen: false,
    },
  },
  {
    input: 'dist/esm/index.d.ts',
    output: [{ file: 'dist/index.d.ts', format: 'esm' }],
    external: [/\.(sc|sa|c)ss$/],
    plugins: [
      dts(),
      peerDepsExternal({ includeDependencies: true }),
      copy({
        targets: [{ src: 'dist/esm/main.css', dest: 'dist' }],
      }),
      bundleSize(),
    ],
  },
]
