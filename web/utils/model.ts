import { basename } from 'path'

import { Model } from '@janhq/core'

export const modelBinFileName = (model: Model) => {
  const modelFormatExt = '.gguf'
  const extractedFileName = basename(model.source_url) ?? model.id
  const fileName = extractedFileName.toLowerCase().endsWith(modelFormatExt)
    ? extractedFileName
    : model.id
  return fileName
}
