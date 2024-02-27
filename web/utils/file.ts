export type FilePathWithSize = {
  path: string
  name: string
  size: number
}

export interface FileWithPath extends File {
  path?: string
}

export const getFileNameFromPath = (filePath: string): string => {
  let fileName = filePath.split('/').pop() ?? ''
  if (fileName.split('.').length > 1) {
    fileName = fileName.split('.').slice(0, -1).join('.')
  }

  return fileName
}

export const getFileInfoFromFile = (
  files: FileWithPath[]
): FilePathWithSize[] => {
  const result: FilePathWithSize[] = []
  for (const file of files) {
    if (file.path && file.path.length > 0) {
      result.push({
        path: file.path,
        name: getFileNameFromPath(file.path),
        size: file.size,
      })
    }
  }
  return result
}
