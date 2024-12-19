export type FileType = 'image' | 'pdf'

export type FileInfo = {
  file: File
  type: FileType
  id?: string
  name?: string
}
