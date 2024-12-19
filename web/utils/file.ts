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

/**
 * This function creates an Uppy instance with XHR plugin for file upload to the server.
 * @returns Uppy instance
 */
export const uploader = () => {
  const uppy = new Uppy().use(XHR, {
    endpoint: `${API_BASE_URL}/v1/files`,
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

/**
 * Get the file information from the server.
 */
export const getFileInfo = (id: string) => {
  return fetch(`${API_BASE_URL}/v1/files/${id}`)
    .then((e) => e.json())
    .catch(() => undefined)
}
