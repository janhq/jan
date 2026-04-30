export function parseBuildNumber(version: string): number | null {
  const match = version.match(/^b(\d+)$/)
  return match ? parseInt(match[1], 10) : null
}
