export function formatCompactNumber(count: number) {
  const formatter = Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
  return formatter.format(count)
}

export const totalDownload = (release: []) => {
  if (release instanceof Array) {
    const count = release
      .map((version: { assets: any[]; name: string }) => {
        // it will be correct since 0.5.15
        const tag = version.name >= '0.5.15' && version.name.includes('0.5.15')

        return version.assets
          .filter((os) => !(tag && os.name.endsWith('.yml')))
          .map((os) => os.download_count)
      })
      .map((x: any[]) => x.reduce((a: any, b: any) => a + b, 0))
      .reduce((a: any, b: any) => a + b, 0)

    return formatCompactNumber(count)
  } else {
    // return dummy to avoid rate limit API when in dev mode
    return formatCompactNumber(9000000)
  }
}
