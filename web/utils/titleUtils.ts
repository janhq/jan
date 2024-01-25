export const openFileTitle = (): string => {
  if (isMac) {
    return 'Show in Finder'
  } else if (isWindows) {
    return 'Show in File Explorer'
  } else {
    return 'Open Containing Folder'
  }
}
