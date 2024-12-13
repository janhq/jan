import { baseName } from '@janhq/core'
import Uppy from '@uppy/core'
import XHR from '@uppy/xhr-upload'

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

export const uploader = () => {
  const uppy = new Uppy().use(XHR, {
    endpoint: 'http://127.0.0.1:39291/v1/files',
    method: 'POST',
    fieldName: 'file',
    formData: true,
    limit: 1,
  })
  uppy.setMeta({
    purpose: 'assistants',
  })
  return uppy
}
