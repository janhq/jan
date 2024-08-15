import { baseName } from '@janhq/core'

export type FilePathWithSize = {
  path: string
  name: string
  size: number
}

export interface FileWithPath extends File {
  path?: string
}

export const getFileInfoFromFile = async (
  files: FileWithPath[]
): Promise<FilePathWithSize[]> => {
  const result: FilePathWithSize[] = []
  for (const file of files) {
    if (file.path && file.path.length > 0) {
      const fileName = await baseName(file.path)

      result.push({
        path: file.path,
        name: fileName,
        size: file.size,
      })
    }
  }
  return result
}
