// Bundles src/worker/prelude.ts into the IIFE that starts every extension
// worker, and wraps it as a JS module whose default export is the source
// text (`@janhq/extension-runtime/prelude-source`). The host needs the text,
// not the code: it composes prelude and bundle into one worker script.
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rolldown } from 'rolldown'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')

// Written through a temporary name: other test projects may read the module
// while this package's tests rebuild it.
async function writeAtomic(file, content) {
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, content)
  await rename(tmp, file)
}

export async function buildPrelude() {
  const bundle = await rolldown({
    input: join(root, 'src/worker/prelude.ts'),
    platform: 'browser',
    // Sources import siblings with `.js` specifiers (NodeNext).
    resolve: { extensionAlias: { '.js': ['.ts', '.js'] } },
  })
  const { output } = await bundle.generate({ format: 'iife' })
  await bundle.close()
  const code = output[0].code
  await mkdir(dist, { recursive: true })
  await writeAtomic(join(dist, 'prelude.js'), code)
  await writeAtomic(
    join(dist, 'prelude-source.js'),
    `export default ${JSON.stringify(code)}\n`
  )
  await writeAtomic(
    join(dist, 'prelude-source.d.ts'),
    '/** The worker prelude IIFE, as source text. */\ndeclare const source: string\nexport default source\n'
  )
  return code
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildPrelude()
}
