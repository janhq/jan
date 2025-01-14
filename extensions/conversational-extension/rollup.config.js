const typescript = require('@rollup/plugin-typescript')
const commonjs = require('@rollup/plugin-commonjs')
const { nodeResolve } = require('@rollup/plugin-node-resolve')
const replace = require('@rollup/plugin-replace')
const json = require('@rollup/plugin-json')
const terser = require('@rollup/plugin-terser')
const path = require('path')

const isProduction = process.env.NODE_ENV === 'production'

/** @type {import('rollup').RollupOptions} */
const config = {
  input: 'src/index.ts',
  output: {
    dir: 'dist',
    format: 'cjs',
    sourcemap: !isProduction,
  },
  plugins: [
    replace({
      preventAssignment: true,
      values: {
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
        API_URL: JSON.stringify('http://127.0.0.1:39291'),
      },
    }),
    nodeResolve({
      preferBuiltins: true,
    }),
    commonjs(),
    typescript({
      tsconfig: path.resolve(__dirname, 'tsconfig.json'),
    }),
    json(),
    isProduction && terser(),
  ].filter(Boolean),
  external: ['@janhq/core'],
}

module.exports = config
