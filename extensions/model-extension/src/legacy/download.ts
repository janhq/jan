import {
  downloadFile,
  DownloadRequest,
  fs,
  GpuSetting,
  InferenceEngine,
  joinPath,
  Model,
} from '@janhq/core'

export const downloadModel = async (
  model: Model,
  gpuSettings?: GpuSetting,
  network?: { ignoreSSL?: boolean; proxy?: string }
): Promise<void> => {
  const homedir = 'file://models'
  const supportedGpuArch = ['ampere', 'ada']
  // Create corresponding directory
  const modelDirPath = await joinPath([homedir, model.id])
  if (!(await fs.existsSync(modelDirPath))) await fs.mkdir(modelDirPath)

  if (model.engine === InferenceEngine.nitro_tensorrt_llm) {
    if (!gpuSettings || gpuSettings.gpus.length === 0) {
      console.error('No GPU found. Please check your GPU setting.')
      return
    }
    const firstGpu = gpuSettings.gpus[0]
    if (!firstGpu.name.toLowerCase().includes('nvidia')) {
      console.error('No Nvidia GPU found. Please check your GPU setting.')
      return
    }
    const gpuArch = firstGpu.arch
    if (gpuArch === undefined) {
      console.error('No GPU architecture found. Please check your GPU setting.')
      return
    }

    if (!supportedGpuArch.includes(gpuArch)) {
      console.debug(
        `Your GPU: ${JSON.stringify(firstGpu)} is not supported. Only 30xx, 40xx series are supported.`
      )
      return
    }

    const os = 'windows' // TODO: remove this hard coded value

    const newSources = model.sources.map((source) => {
      const newSource = { ...source }
      newSource.url = newSource.url
        .replace(/<os>/g, os)
        .replace(/<gpuarch>/g, gpuArch)
      return newSource
    })
    model.sources = newSources
  }

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
