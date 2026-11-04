// Builds dist/index.js from rolldown.config.mjs. A module rather than only
// `rolldown -c` so test global setups (this package's and web-app's) can
// rebuild the bundle before the tests that run it.
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rolldown } from 'rolldown'
import config from '../rolldown.config.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

export const bundlePath = join(root, config.output.file)

export async function buildBundle() {
  const { output: outputOptions, ...input } = config
  const bundle = await rolldown({
    ...input,
    cwd: root,
    input: join(root, input.input),
  })
  const { output } = await bundle.generate(outputOptions)
  await bundle.close()
  const code = output[0].code
  await mkdir(dirname(bundlePath), { recursive: true })
  // Through a temporary name: two test projects may build it at once.
  const tmp = `${bundlePath}.${process.pid}.tmp`
  await writeFile(tmp, code)
  await rename(tmp, bundlePath)
  return code
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildBundle()
}
