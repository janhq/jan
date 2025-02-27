export const toGigabytes = (
  input: number,
  options?: { hideUnit?: boolean; toFixed?: number }
) => {
  if (!input) return ''
  if (input > 1024 ** 3) {
    return (
      (input / 1024 ** 3).toFixed(options?.toFixed ?? 2) +
      (options?.hideUnit ? '' : 'GB')
    )
  } else if (input > 1024 ** 2) {
    return (
      (input / 1024 ** 2).toFixed(options?.toFixed ?? 2) +
      (options?.hideUnit ? '' : 'MB')
    )
  } else if (input > 1024) {
    return (
      (input / 1024).toFixed(options?.toFixed ?? 2) +
      (options?.hideUnit ? '' : 'KB')
    )
  } else {
    return input + (options?.hideUnit ? '' : 'B')
  }
}

export const formatDownloadPercentage = (
  input: number,
  options?: { hidePercentage?: boolean }
) => {
  if (options?.hidePercentage) return input <= 1 ? input * 100 : input
  return (input <= 1 ? input * 100 : (input ?? 0)).toFixed(2) + '%'
}

export const formatDownloadSpeed = (input: number | undefined) => {
  if (!input) return '0B/s'
  return toGigabytes(input) + '/s'
}

export const formatTwoDigits = (input: number) => {
  input = Number(input)

  return input.toFixed(2)
}

export const formatExtensionsName = (input: string) => {
  return input.replace('@janhq/', '').replaceAll('-', ' ')
}
