export type OptionType = 'symlink' | 'copy'

export type ModelImportOption = {
  type: OptionType
  title: string
  description: string
}

export type ImportingModelStatus = 'PREPARING' | 'IMPORTING' | 'IMPORTED' | 'FAILED'

export type ImportingModel = {
  importId: string
  modelId: string | undefined
  name: string
  description: string
  path: string
  tags: string[]
  size: number
  status: ImportingModelStatus
  format: string
  percentage?: number
  error?: string
}
