import {
  fs,
  downloadFile,
  abortDownload,
  joinPath,
  HuggingFaceExtension,
  HuggingFaceRepoData,
  executeOnMain,
  Quantization,
  Model,
  InferenceEngine,
  getJanDataFolderPath,
  events,
  DownloadEvent,
  log,
} from '@janhq/core'
import { ggufMetadata } from 'hyllama'

declare global {
  interface Window {
    electronAPI?: any
  }
}

/**
 * A extension for models
 */
export default class JanHuggingFaceExtension extends HuggingFaceExtension {
  private static readonly _safetensorsRegexs = [
    /model\.safetensors$/,
    /model-[0-9]+-of-[0-9]+\.safetensors$/,
  ]
  private static readonly _pytorchRegexs = [
    /pytorch_model\.bin$/,
    /consolidated\.[0-9]+\.pth$/,
    /pytorch_model-[0-9]+-of-[0-9]+\.bin$/,
    /.*\.pt$/,
  ]
  interrupted = false

  /**
   * Called when the extension is loaded.
   * @override
   */
  onLoad() {}

  /**
   * Called when the extension is unloaded.
   * @override
   */
  onUnload(): void {}

  private getFileList(repoData: HuggingFaceRepoData): string[] {
    // SafeTensors first, if not, then PyTorch
    const modelFiles = repoData.siblings
      .map((file) => file.rfilename)
      .filter((file) =>
        JanHuggingFaceExtension._safetensorsRegexs.some((regex) =>
          regex.test(file)
        )
      )
    if (modelFiles.length === 0) {
      repoData.siblings.forEach((file) => {
        if (
          JanHuggingFaceExtension._pytorchRegexs.some((regex) =>
            regex.test(file.rfilename)
          )
        ) {
          modelFiles.push(file.rfilename)
        }
      })
    }

    const vocabFiles = [
      'tokenizer.model',
      'vocab.json',
      'tokenizer.json',
    ].filter((file) =>
      repoData.siblings.some((sibling) => sibling.rfilename === file)
    )

    const etcFiles = repoData.siblings
      .map((file) => file.rfilename)
      .filter(
        (file) =>
          (file.endsWith('.json') && !vocabFiles.includes(file)) ||
          file.endsWith('.txt') ||
          file.endsWith('.py') ||
          file.endsWith('.tiktoken')
      )

    return [...modelFiles, ...vocabFiles, ...etcFiles]
  }

  private async getModelDirPath(repoID: string): Promise<string> {
    const modelName = repoID.split('/').slice(1).join('/')
    return joinPath([await getJanDataFolderPath(), 'models', modelName])
  }
  private async getConvertedModelPath(repoID: string): Promise<string> {
    const modelName = repoID.split('/').slice(1).join('/')
    const modelDirPath = await this.getModelDirPath(repoID)
    return joinPath([modelDirPath, modelName + '.gguf'])
  }
  private async getQuantizedModelPath(
    repoID: string,
    quantization: Quantization
  ): Promise<string> {
    const modelName = repoID.split('/').slice(1).join('/')
    const modelDirPath = await this.getModelDirPath(repoID)
    return joinPath([
      modelDirPath,
      modelName + `-${quantization.toLowerCase()}.gguf`,
    ])
  }
  private getCtxLength(config: {
    max_sequence_length?: number
    max_position_embeddings?: number
    n_ctx?: number
  }): number {
    if (config.max_sequence_length) return config.max_sequence_length
    if (config.max_position_embeddings) return config.max_position_embeddings
    if (config.n_ctx) return config.n_ctx
    return 4096
  }

  /**
   * Downloads a Hugging Face model.
   * @param repoID - The repo ID of the model to convert.
   * @param repoData - The repo data of the model to convert.
   * @param network - Optional object to specify proxy/whether to ignore SSL certificates.
   * @returns A promise that resolves when the download is complete.
   */
  async downloadModelFiles(
    repoID: string,
    repoData: HuggingFaceRepoData,
    network?: { ignoreSSL?: boolean; proxy?: string }
  ): Promise<void> {
    if (this.interrupted) return
    const modelDirPath = await this.getModelDirPath(repoID)
    if (!(await fs.existsSync(modelDirPath))) await fs.mkdirSync(modelDirPath)
    const files = this.getFileList(repoData)
    const filePaths: string[] = []

    for (const file of files) {
      const filePath = file
      const localPath = await joinPath([modelDirPath, filePath])
      const url = `https://huggingface.co/${repoID}/resolve/main/${filePath}`

      if (this.interrupted) return
      if (!(await fs.existsSync(localPath))) {
        downloadFile(url, localPath, network)
        filePaths.push(filePath)
      }
    }

    await new Promise<void>((resolve, reject) => {
      if (filePaths.length === 0) resolve()
      const onDownloadSuccess = async ({ fileName }: { fileName: string }) => {
        if (filePaths.includes(fileName)) {
          filePaths.splice(filePaths.indexOf(fileName), 1)
          if (filePaths.length === 0) {
            events.off(DownloadEvent.onFileDownloadSuccess, onDownloadSuccess)
            events.off(DownloadEvent.onFileDownloadError, onDownloadError)
            resolve()
          }
        }
      }

      const onDownloadError = async ({
        fileName,
        error,
      }: {
        fileName: string
        error: Error
      }) => {
        if (filePaths.includes(fileName)) {
          this.cancelConvert(repoID, repoData)
          events.off(DownloadEvent.onFileDownloadSuccess, onDownloadSuccess)
          events.off(DownloadEvent.onFileDownloadError, onDownloadError)
          reject(error)
        }
      }

      events.on(DownloadEvent.onFileDownloadSuccess, onDownloadSuccess)
      events.on(DownloadEvent.onFileDownloadError, onDownloadError)
    })
  }

  /**
   * Converts a Hugging Face model to GGUF.
   * @param repoID - The repo ID of the model to convert.
   * @returns A promise that resolves when the conversion is complete.
   */
  async convert(repoID: string): Promise<void> {
    if (this.interrupted) return
    const modelDirPath = await this.getModelDirPath(repoID)
    const modelOutPath = await this.getConvertedModelPath(repoID)
    if (!(await fs.existsSync(modelDirPath))) {
      throw new Error('Model dir not found')
    }
    if (await fs.existsSync(modelOutPath)) return

    await executeOnMain(NODE_MODULE_PATH, 'installDeps')
    if (this.interrupted) return

    try {
      await executeOnMain(
        NODE_MODULE_PATH,
        'convertHf',
        modelDirPath,
        modelOutPath + '.temp'
      )
    } catch (err) {
      log(`[Conversion]::Debug: Error using hf-to-gguf.py, trying convert.py`)

      let ctx = 4096
      try {
        const config = await fs.readFileSync(
          await joinPath([modelDirPath, 'config.json']),
          'utf8'
        )
        const configParsed = JSON.parse(config)
        ctx = this.getCtxLength(configParsed)
        configParsed.max_sequence_length = ctx
        await fs.writeFileSync(
          await joinPath([modelDirPath, 'config.json']),
          JSON.stringify(configParsed, null, 2)
        )
      } catch (err) {
        log(`${err}`)
        // ignore missing config.json
      }

      const bpe = await fs.existsSync(
        await joinPath([modelDirPath, 'vocab.json'])
      )

      await executeOnMain(
        NODE_MODULE_PATH,
        'convert',
        modelDirPath,
        modelOutPath + '.temp',
        {
          ctx,
          bpe,
        }
      )
    }
    await executeOnMain(
      NODE_MODULE_PATH,
      'renameSync',
      modelOutPath + '.temp',
      modelOutPath
    )

    for (const file of await fs.readdirSync(modelDirPath)) {
      if (
        modelOutPath.endsWith(file) ||
        (file.endsWith('config.json') && !file.endsWith('_config.json'))
      )
        continue
      await fs.unlinkSync(await joinPath([modelDirPath, file]))
    }
  }

  /**
   * Quantizes a GGUF model.
   * @param repoID - The repo ID of the model to quantize.
   * @param quantization - The quantization to use.
   * @returns A promise that resolves when the quantization is complete.
   */
  async quantize(repoID: string, quantization: Quantization): Promise<void> {
    if (this.interrupted) return
    const modelDirPath = await this.getModelDirPath(repoID)
    const modelOutPath = await this.getQuantizedModelPath(repoID, quantization)
    if (!(await fs.existsSync(modelDirPath))) {
      throw new Error('Model dir not found')
    }
    if (await fs.existsSync(modelOutPath)) return

    await executeOnMain(
      NODE_MODULE_PATH,
      'quantize',
      await this.getConvertedModelPath(repoID),
      modelOutPath + '.temp',
      quantization
    )
    await executeOnMain(
      NODE_MODULE_PATH,
      'renameSync',
      modelOutPath + '.temp',
      modelOutPath
    )

    await fs.unlinkSync(await this.getConvertedModelPath(repoID))
  }

  /**
   * Generates Jan model metadata from a Hugging Face model.
   * @param repoID - The repo ID of the model to generate metadata for.
   * @param repoData - The repo data of the model to generate metadata for.
   * @param quantization - The quantization of the model.
   * @returns A promise that resolves when the model metadata generation is complete.
   */
  async generateMetadata(
    repoID: string,
    repoData: HuggingFaceRepoData,
    quantization: Quantization
  ): Promise<void> {
    const modelName = repoID.split('/').slice(1).join('/')
    const filename = `${modelName}-${quantization.toLowerCase()}.gguf`
    const modelDirPath = await this.getModelDirPath(repoID)
    const modelPath = await this.getQuantizedModelPath(repoID, quantization)
    const modelConfigPath = await joinPath([modelDirPath, 'model.json'])
    if (!(await fs.existsSync(modelPath))) {
      throw new Error('Model not found')
    }

    const size = await executeOnMain(NODE_MODULE_PATH, 'getSize', modelPath)
    let ctx = 4096
    try {
      const config = await fs.readFileSync(
        await joinPath([modelDirPath, 'config.json']),
        'utf8'
      )
      ctx = this.getCtxLength(JSON.parse(config))
      fs.unlinkSync(await joinPath([modelDirPath, 'config.json']))
    } catch (err) {
      // ignore missing config.json
    }
    // maybe later, currently it's gonna use too much memory
    // const buffer = await fs.readFileSync(quantizedModelPath)
    // const ggufData = ggufMetadata(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength))

    const metadata: Model = {
      object: 'model',
      version: 1,
      format: 'gguf',
      sources: [
        {
          url: `https://huggingface.co/${repoID}`, // i think this is just for download but not sure,
          filename,
        },
      ],
      id: modelName,
      name: modelName,
      created: Date.now(),
      description: `Auto converted from Hugging Face model: ${repoID}`,
      settings: {
        ctx_len: ctx,
        prompt_template: '',
        llama_model_path: modelName,
      },
      parameters: {
        temperature: 0.7,
        top_p: 0.95,
        stream: true,
        max_tokens: 4096,
        // stop: [''], seems like we dont really need this..?
        frequency_penalty: 0,
        presence_penalty: 0,
      },
      metadata: {
        author: repoData.author,
        tags: repoData.tags,
        size,
      },
      engine: InferenceEngine.nitro,
    }

    await fs.writeFileSync(modelConfigPath, JSON.stringify(metadata, null, 2))
  }

  /**
   * Cancels the convert of current Hugging Face model.
   * @param repoID - The repository ID to cancel.
   * @param repoData - The repository data to cancel.
   * @returns {Promise<void>} A promise that resolves when the download has been cancelled.
   */
  async cancelConvert(
    repoID: string,
    repoData: HuggingFaceRepoData
  ): Promise<void> {
    this.interrupted = true
    const modelDirPath = await this.getModelDirPath(repoID)
    const files = this.getFileList(repoData)
    for (const file of files) {
      const filePath = file
      const localPath = await joinPath([modelDirPath, filePath])
      await abortDownload(localPath)
    }
    // ;(await fs.existsSync(modelDirPath)) && (await fs.rmdirSync(modelDirPath))

    executeOnMain(NODE_MODULE_PATH, 'killProcesses')
  }
}
