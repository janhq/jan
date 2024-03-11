export const convertKeyToAccelerator = (key: string[]): string[] => {
  return key.map((k) => {
    if (process.platform === 'darwin') {
      return convertMacOsKey(k)
    } else {
      return convertWindowsAndLinuxKey(k)
    }
  })
}

const convertWindowsAndLinuxKey = (key: string): string => {
  switch (key) {
    case 'meta':
      return 'Super'
    case 'ctrl':
      return 'Control'
    case 'shift':
      return 'Shift'
    case 'alt':
      return 'Alt'
    default:
      return key
  }
}

const convertMacOsKey = (key: string): string => {
  switch (key) {
    case 'meta':
      return 'Command'
    case 'ctrl':
      return 'Control'
    case 'shift':
      return 'Shift'
    case 'alt':
      return 'Option'
    default:
      return key
  }
}
