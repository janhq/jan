/**
 * Normalize file path
 * Remove all file protocol prefix
 * @param path 
 * @returns 
 */
export function normalizeFilePath(path: string): string {
  return path.replace(/^(file:[\\/]+)([^:\s]+)$/, "$2");
}
