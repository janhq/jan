import type { PythonShell } from 'python-shell'
import {
  fs,
  downloadFile,
  abortDownload,
  getResourcePath,
  InferenceEngine,
  joinPath,
  ModelExtension,
  Model,
  getJanDataFolderPath,
  HuggingFaceExtension,
  HuggingFaceRepoData,
  executeOnMain,
} from '@janhq/core'

/**
 * A extension for models
 */
export default class JanHuggingFaceExtension extends HuggingFaceExtension {
  private static readonly _homeDir = 'file://models'
  private static readonly _modelMetadataFileName = 'model.json'
  private static readonly _incompletedModelFileName = '.download'
  private static readonly _offlineInferenceEngine = InferenceEngine.nitro

  private static readonly _configDirName = 'config'
  private static readonly _defaultModelFileName = 'default-model.json'
  private static readonly _safetensorsRegexs = [
    /model\.safetensors$/,
    /model-[0-9]+-of[0-9]+\.safetensors$/,
  ]
  private static readonly _pytorchRegexs = [
    /pytorch_model\.bin$/,
    /consolidated\.[0-9]+\.pth$/,
    /pytorch_model-[0-9]+-of-[0-9]+\.bin$/,
    /.*\.pt$/,
  ]
  private interupted = false

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

    return [...modelFiles, ...vocabFiles]
  }

  /**
   * Downloads and converts a Hugging Face model to GGUF.
   * @param repoID - The repo ID of the model to convert.
   * @param repoData - The repo data of the model to convert.
   * @param network - Optional object to specify proxy/whether to ignore SSL certificates.
   * @returns A promise that resolves when the conversion is complete.
   */
  async convert(
    repoID: string,
    repoData: HuggingFaceRepoData,
    network?: { ignoreSSL?: boolean; proxy?: string }
  ): Promise<void> {
    this.interupted = false
    const modelName = repoID.split('/').slice(1).join('/')
    const modelDirPath = await joinPath([
      JanHuggingFaceExtension._homeDir,
      modelName,
    ])
    if (!(await fs.existsSync(modelDirPath))) await fs.mkdirSync(modelDirPath)
    const files = this.getFileList(repoData)

    for (const file of files) {
      const filePath = file
      const localPath = await joinPath([modelDirPath, filePath])
      const url = `https://huggingface.co/${repoID}/resolve/main/${filePath}`

      if (this.interupted) return
      await downloadFile(url, localPath, network)
    }

    if (this.interupted) return
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
    this.interupted = true
    const modelName = repoID.split('/').slice(1).join('/')
    const modelDirPath = await joinPath([
      JanHuggingFaceExtension._homeDir,
      modelName,
    ])
    const files = this.getFileList(repoData)
    for (const file of files) {
      const filePath = file
      const localPath = await joinPath([modelDirPath, filePath])
      await abortDownload(localPath)
      fs.existsSync(localPath) && fs.unlinkSync(localPath)
    }

    executeOnMain(NODE_MODULE_PATH, 'killPythonShell')
  }

  private installDeps(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.pythonShell = new PythonShell(await getResourcePath(), {
        pythonPath: 'python3',
        scriptPath: getResourcePath('python', 'huggingface'),
        mode: 'text',
      })
      this.pythonShell.on('message', (message) => {
        if (message === 'done') {
          resolve()
        }
      })
      this.pythonShell.on('error', (err) => {
        reject(err)
      })
    })
  }
}
