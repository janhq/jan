import { Model } from '@janhq/core'

export const modelBinFileName = (model: Model) => {
  const modelFormatExt = '.gguf'
  const extractedFileName = model.sources[0]?.url.split('/').pop() ?? model.id
  const fileName = extractedFileName.toLowerCase().endsWith(modelFormatExt)
    ? extractedFileName
    : model.id
  return fileName
}
