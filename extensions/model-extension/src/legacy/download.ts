import {
  downloadFile,
  DownloadRequest,
  fs,
  joinPath,
  Model,
} from '@janhq/core'

export const downloadModel = async (
  model: Model,
  network?: { ignoreSSL?: boolean; proxy?: string }
): Promise<void> => {
  const homedir = 'file://models'
  const supportedGpuArch = ['ampere', 'ada']
  // Create corresponding directory
  const modelDirPath = await joinPath([homedir, model.id])
  if (!(await fs.existsSync(modelDirPath))) await fs.mkdir(modelDirPath)

  const jsonFilePath = await joinPath([modelDirPath, 'model.json'])
  // Write model.json on download
  if (!(await fs.existsSync(jsonFilePath)))
    await fs.writeFileSync(
      jsonFilePath,
      JSON.stringify(model, null, 2)
    )

  console.debug(`Download sources: ${JSON.stringify(model.sources)}`)

  if (model.sources.length > 1) {
    // path to model binaries
    for (const source of model.sources) {
      let path = extractFileName(source.url, '.gguf')
      if (source.filename) {
        path = await joinPath([modelDirPath, source.filename])
      }

      const downloadRequest: DownloadRequest = {
        url: source.url,
        localPath: path,
        modelId: model.id,
      }
      downloadFile(downloadRequest, network)
    }
  } else {
    const fileName = extractFileName(model.sources[0]?.url, '.gguf')
    const path = await joinPath([modelDirPath, fileName])
    const downloadRequest: DownloadRequest = {
      url: model.sources[0]?.url,
      localPath: path,
      modelId: model.id,
    }
    downloadFile(downloadRequest, network)
  }
}

/**
 *  try to retrieve the download file name from the source url
 */
function extractFileName(url: string, fileExtension: string): string {
  if (!url) return fileExtension

  const extractedFileName = url.split('/').pop()
  const fileName = extractedFileName.toLowerCase().endsWith(fileExtension)
    ? extractedFileName
    : extractedFileName + fileExtension
  return fileName
}
