import path from 'path'

function buildUnsafePathError(archiveType, entryPath) {
  return new Error(`Unsafe ${archiveType} entry path: ${entryPath}`)
}

export function assertSafeArchivePath(entryPath, targetDir, archiveType) {
  const rawPath = typeof entryPath === 'string' ? entryPath : ''
  const sourcePath = rawPath.replaceAll('\\', '/')
  const normalizedPath = path.posix.normalize(sourcePath)
  const hasWindowsDrive = /^[a-zA-Z]:\//.test(sourcePath)

  if (
    !rawPath ||
    sourcePath.startsWith('/') ||
    hasWindowsDrive ||
    normalizedPath === '..' ||
    normalizedPath.startsWith('../')
  ) {
    throw buildUnsafePathError(archiveType, entryPath)
  }

  const targetRoot = path.resolve(targetDir)
  const destinationPath = path.resolve(targetRoot, normalizedPath)
  if (destinationPath !== targetRoot && !destinationPath.startsWith(`${targetRoot}${path.sep}`)) {
    throw buildUnsafePathError(archiveType, entryPath)
  }
}

export function isZipSymlink(entry) {
  const mode = (Number(entry?.externalFileAttributes || 0) >>> 16) & 0o170000
  return mode === 0o120000
}

export function assertSafeZipEntry(entry, targetDir) {
  assertSafeArchivePath(entry.path, targetDir, '.zip')
  if (isZipSymlink(entry)) {
    throw new Error(`Unsafe .zip entry type: ${entry.path}`)
  }
}

export function assertSafeTarEntry(entryPath, entry, targetDir) {
  assertSafeArchivePath(entryPath, targetDir, '.tar.gz')
  if (entry && (entry.type === 'SymbolicLink' || entry.type === 'Link')) {
    throw new Error(`Unsafe .tar.gz entry type: ${entryPath}`)
  }
}
