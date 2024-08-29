/**
 * Calculate the percentage of memory used
 * @param free
 * @param total
 * @returns
 */
export const utilizedMemory = (free: number, total: number) => {
  return Math.round(((total - free) / Math.max(total, 1)) * 100)
}
