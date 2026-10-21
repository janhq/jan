// Builds src-tauri/icons-windows/icon.ico from src-tauri/icons-windows/icon.png.
//
// `tauri icon` writes an .ico with a fixed set of six sizes (16, 24, 32, 48, 64,
// 256). Windows asks for more than that: at 125%/150%/250%/300% display scale it
// wants 20, 30, 36, 40, 60, 72, 80 and 96px, and when an exact size is missing it
// scales the next larger one down. So render every size Microsoft lists for
// Win32 apps with `tauri icon --png` and pack them into one ICO.
//
// https://learn.microsoft.com/en-us/windows/apps/design/iconography/app-icon-construction
//
// Node rather than shell for the same reason as stub-tauri-resources.mjs: a
// stock Windows box has no bash on PATH, and this runs from a package.json script.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ICO_SIZES = [
  16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256,
]

/** Packs PNG buffers (one per square size) into an ICO. PNG entries are valid
 *  for every size on Windows Vista and later, and are what `tauri icon` emits. */
export function packIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(entries.length, 4)

  const directory = Buffer.alloc(16 * entries.length)
  let offset = header.length + directory.length
  entries.forEach(({ size, png }, i) => {
    const at = i * 16
    // A width/height byte of 0 means 256.
    directory.writeUInt8(size >= 256 ? 0 : size, at)
    directory.writeUInt8(size >= 256 ? 0 : size, at + 1)
    directory.writeUInt16LE(1, at + 4) // colour planes
    directory.writeUInt16LE(32, at + 6) // bits per pixel
    directory.writeUInt32LE(png.length, at + 8)
    directory.writeUInt32LE(offset, at + 12)
    offset += png.length
  })
  return Buffer.concat([header, directory, ...entries.map((e) => e.png)])
}

function build(repoRoot) {
  const dir = join(repoRoot, 'src-tauri', 'icons-windows')
  const source = join(dir, 'icon.png')
  const scratch = mkdtempSync(join(tmpdir(), 'jan-ico-'))
  try {
    // `tauri` is a .cmd shim on Windows, which execFile only runs through a shell.
    execFileSync(
      'tauri',
      [
        'icon',
        source,
        '-o',
        scratch,
        ...ICO_SIZES.flatMap((size) => ['-p', String(size)]),
      ],
      { stdio: 'inherit', shell: process.platform === 'win32', cwd: repoRoot }
    )
    const entries = ICO_SIZES.map((size) => ({
      size,
      png: readFileSync(join(scratch, `${size}x${size}.png`)),
    }))
    writeFileSync(join(dir, 'icon.ico'), packIco(entries))
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  build(fileURLToPath(new URL('..', import.meta.url)))
}
