import { defineConfig } from 'rolldown'

// The bundle contract of a worker extension: one IIFE file that assigns the
// global `JanExtension` and imports nothing at runtime. The host appends it
// to the worker prelude and calls `__janBoot(JanExtension)`.
export default defineConfig({
  input: 'src/index.ts',
  platform: 'browser',
  output: {
    format: 'iife',
    name: 'JanExtension',
    file: 'dist/index.js',
  },
})
