export const toGibibytes = (input: number) => {
  if (!input) return ''
  if (input > 1024 ** 3) {
    return (input / 1024 ** 3).toFixed(2) + 'GB'
  } else if (input > 1024 ** 2) {
    return (input / 1024 ** 2).toFixed(2) + 'MB'
  } else if (input > 1024) {
    return (input / 1024).toFixed(2) + 'KB'
  } else {
    return input + 'B'
  }
}

export const formatDownloadPercentage = (
  input: number,
  options?: { hidePercentage?: boolean }
) => {
  if (options?.hidePercentage) return input * 100
  return (input * 100).toFixed(2) + '%'
}

export const formatDownloadSpeed = (input: number | undefined) => {
  if (!input) return '0B/s'
  return toGibibytes(input) + '/s'
}

export const formatTwoDigits = (input: number) => {
  input = Number(input)

  return input.toFixed(2)
}

export const formatExtensionsName = (input: string) => {
  return input.replace('@janhq/', '').replaceAll('-', ' ')
}
