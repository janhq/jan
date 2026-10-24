// Builds the API report: every declaration file the package build emits,
// concatenated in path order. It is committed as api-report.d.ts so that any
// change to the public surface shows up as a reviewed diff.
//
//   node scripts/api-report.mjs           rewrite api-report.d.ts
//   node scripts/api-report.mjs --stdout  print the report (used by the test)
//
// Declarations are emitted in memory with the same tsconfig as the build, so
// the report needs no prior build, no network and no tool beyond typescript.
import { writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPORT = join(ROOT, 'api-report.d.ts')

function emitDeclarations() {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    join(ROOT, 'tsconfig.build.json'),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (d) => {
        throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n'))
      },
    }
  )
  if (!parsed) throw new Error('tsconfig.build.json could not be read')
  const options = {
    ...parsed.options,
    declaration: true,
    emitDeclarationOnly: true,
    declarationMap: false,
    sourceMap: false,
    noEmit: false,
  }
  const program = ts.createProgram(parsed.fileNames, options)
  const files = new Map()
  const result = program.emit(undefined, (fileName, text) => {
    if (fileName.endsWith('.d.ts')) files.set(fileName, text)
  })
  const diagnostics = [
    ...ts.getPreEmitDiagnostics(program),
    ...result.diagnostics,
  ]
  if (diagnostics.length > 0) {
    throw new Error(
      ts.formatDiagnostics(diagnostics, {
        getCanonicalFileName: (f) => f,
        getCurrentDirectory: () => ROOT,
        getNewLine: () => '\n',
      })
    )
  }
  return files
}

function normalize(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .trim()
}

export function buildApiReport() {
  const outDir = join(ROOT, 'dist')
  const sections = [...emitDeclarations()]
    .map(([fileName, text]) => [
      relative(outDir, fileName).split('\\').join('/'),
      normalize(text),
    ])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, text]) => `// ---- ${name} ----\n\n${text}\n`)
  return [
    '// API report for @janhq/extension-api. Generated; do not edit.',
    '// Update with: yarn workspace @janhq/extension-api api-report',
    '',
    sections.join('\n'),
  ].join('\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = buildApiReport()
  if (process.argv.includes('--stdout')) process.stdout.write(report)
  else writeFileSync(REPORT, report)
}
