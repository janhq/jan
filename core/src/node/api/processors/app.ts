import { join, resolve, relative, normalize, sep } from 'path'
import { existsSync } from 'fs'

/**
 * Sanitizes a user-provided path to prevent path traversal attacks
 * @param userPath - The user-provided path component
 * @param basePath - The base directory that should contain the final path
 * @returns Sanitized path or null if invalid
 */
function sanitizePath(userPath: string, basePath: string): string | null {
  if (!userPath || typeof userPath !== 'string') {
    return null
  }

  // Remove dangerous sequences and null bytes
  const cleaned = userPath
    .replace(/\.\./g, '') // Remove all ../ sequences
    .replace(/\0/g, '') // Remove null bytes
    .replace(/[<>:"|?*]/g, '') // Remove other potentially dangerous characters

  // Normalize and resolve the path
  const resolvedBase = resolve(basePath)
  const candidatePath = resolve(resolvedBase, cleaned)

  // Ensure the resolved path is within the base directory
  const relativePath = relative(resolvedBase, candidatePath)
  
  // If relative path starts with .. or is absolute, it's outside base directory
  if (relativePath.startsWith('..') || resolve(relativePath) === relativePath) {
    return null
  }

  return candidatePath
}

// Replace the vulnerable line 30 with secure path handling
export function processAppPath(userProvidedPath: string, baseDir: string): string | null {
  const safePath = sanitizePath(userProvidedPath, baseDir)
  
  if (!safePath) {
    throw new Error('Invalid path provided')
  }
  
  return safePath
}

// If the original code was using path.join directly, replace it with:
// const safePath = sanitizePath(userInput, baseDirectory)
// if (!safePath) {
//   throw new Error('Invalid path')
// }
// // Use safePath instead of path.join(baseDirectory, userInput)
