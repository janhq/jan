export function formatCompactNumber(count: number) {
  const formatter = Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 1,
  })
  return formatter.format(count)
}

export function formatFileSize(bytes: number): string {
  if (!bytes) return '0 B'

  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))

  if (i === 0) return `${bytes} ${sizes[i]}`

  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`
}

export const totalDownload = (release: []) => {
  if (release instanceof Array) {
    const count = release
      .map((version: { assets: any[]; name: string }) => {
<<<<<<< HEAD
        // it will be correct since 0.5.15
        const tag = version.name >= '0.5.15' && version.name.includes('0.5.15')

        return version.assets
          .filter((os) => !(tag && os.name.endsWith('.yml')))
=======
        return version.assets
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
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
