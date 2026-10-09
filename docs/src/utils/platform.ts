// User-Agent Client Hints aren't in TypeScript's DOM lib yet, so type the one
// call we make.
type NavigatorWithUAData = Navigator & {
  userAgentData?: {
    getHighEntropyValues?: (
      hints: string[]
    ) => Promise<{ architecture?: string }>
  }
}

// Windows on ARM reports the same user agent string as x64, so only Client
// Hints (Chromium/Edge) can tell them apart. Resolves false everywhere else,
// which keeps the x64 installer as the Windows default.
export const isWindowsArm = async (): Promise<boolean> => {
  if (typeof navigator === 'undefined') return false
  if (!navigator.userAgent.includes('Windows')) return false

  try {
    const values = await (
      navigator as NavigatorWithUAData
    ).userAgentData?.getHighEntropyValues?.(['architecture'])
    return values?.architecture === 'arm'
  } catch {
    return false
  }
}
