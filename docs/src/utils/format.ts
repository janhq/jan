export function formatCompactNumber(count: number) {
  const formatter = Intl.NumberFormat('en', { notation: 'compact' })
  return formatter.format(count)
}

export const totalDownload = (release: []) => {
  if (release instanceof Array) {
    const count = release
      .map((version: { assets: any[] }) =>
        version.assets.map((os) => os.download_count)
      )
      .map((x: any[]) => x.reduce((a: any, b: any) => a + b, 0))
      .reduce((a: any, b: any) => a + b, 0)

    return formatCompactNumber(count)
  } else {
    // return dummy avoid reate limit API when dev mode
    return formatCompactNumber(9000000)
  }
}
