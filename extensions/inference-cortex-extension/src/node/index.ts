import fs from 'fs'
import path, { join } from 'path'
import tcpPortUsed from 'tcp-port-used'
import fetchRT from 'fetch-retry'
import {
  log,
  getSystemResourceInfo,
  Model,
  InferenceEngine,
  ModelSettingParams,
  PromptTemplate,
  SystemInformation,
  DownloadState,
  getJanDataFolderPath,
} from '@janhq/core/node'
import EventSource from 'eventsource'

interface InitEngineOptions {
    runMode?: 'CPU' | 'GPU';
    gpuType?: 'Nvidia' | 'Others (Vulkan)';
    instructions?: 'AVX' | 'AVX2' | 'AVX512' | undefined;
    cudaVersion?: '11' | '12';
    silent?: boolean;
    vulkan?: boolean;
    version?: string;
}

enum EngineStatus {
    NOT_SUPPORTED = 'not_supported',
    READY = 'ready',
    MISSING_CONFIGURATION = 'missing_configuration',
    NOT_INITIALIZED = 'not_initialized',
    ERROR = 'error',

}

interface EngineInformation {
  name: string;
  description: string;
  version: string;
  productName: string;
  status: EngineStatus;
}


// Polyfill fetch with retry
const fetchRetry = fetchRT(fetch)

/**
 * The response object for model init operation.
 */
interface ModelInitOptions {
  modelFolder: string
  model: Model
}
let cortexProcessInstance: any
class CortexProcess {
// The PORT to use for the Cortex subprocess
port = 1338
// The HOST address to use for the Cortex subprocess
host = '127.0.0.1'

// The PORT to use for the Cortex engine subprocess
enginePort = 3930
// The URL for the Cortex subprocess
getUrls = () => {
  // The URL for the Cortex subprocess
  const CORTEX_HTTP_SERVER_URL = `http://${this.host}:${this.port}`
  return {
    cortexHttpServerUrl: CORTEX_HTTP_SERVER_URL,
    // The URL for the Cortex subprocess to load a model
    cortexHttpLoadModelUrl: (modelId: string) =>
      `${CORTEX_HTTP_SERVER_URL}/v1/models/${modelId}/start-by-file`,
    // The URL for the Cortex subprocess to unload a model
    cortexHttpUnloadModelUrl: (modelId: string) =>
      `${CORTEX_HTTP_SERVER_URL}/v1/models/${modelId}/stop`,
    // The URL for the Cortex subprocess to kill itself
    cortexHttpKillUrl: `${CORTEX_HTTP_SERVER_URL}/v1/system`,
    // The URL for the Cortex subprocess to check health
    cortexHealthCheckUrl: `${CORTEX_HTTP_SERVER_URL}/v1/system`,
    // The URL for the Cortex subprocess to init engine
    cortexInitEngineUrl: (engine: string) =>
      `${CORTEX_HTTP_SERVER_URL}/v1/engines/${engine}/init`,
    // The URL for the Cortex subprocess to get engine information
    cortexEngineInfo: (engine: string) =>
      `${CORTEX_HTTP_SERVER_URL}/v1/engines/${engine}`,
    cortexEngineDownloadEvent: `${CORTEX_HTTP_SERVER_URL}/v1/system/events/download`,
    cortexAbortDownload: (downloadId: string) => `${CORTEX_HTTP_SERVER_URL}/v1/models/${downloadId}/abort`,
}
}

setPort = (port: number) => {
  this.port = port
}

setHost = (host: string) => {
  this.host = host
}

setEnginePort = (port: number) => {
  this.enginePort = port
}
}


const cortexProcess = new CortexProcess()

const setPort = (port: number) => {
  cortexProcess.setPort(port)
}

const setHost = (host: string) => {
  cortexProcess.setHost(host)
}

const setEnginePort = (port: number) => {
  cortexProcess.setEnginePort(port)
}
const CORTEX_PORT_FREE_CHECK_INTERVAL = 100

// The supported model format
// TODO: Should be an array to support more models
const SUPPORTED_MODEL_FORMAT = '.gguf'

// The current model settings
let currentSettings: (ModelSettingParams & { model?: string }) | undefined =
  undefined

  
/**
 * Stops a Cortex subprocess.
 * @param wrapper - The model wrapper.
 * @returns A Promise that resolves when the subprocess is terminated successfully, or rejects with an error message if the subprocess fails to terminate.
 */
async function unloadModel(modelId: string): Promise<void> {
  log(`[CORTEX]::Debug: Unloading model ${modelId}`)
  const { cortexHttpUnloadModelUrl } = cortexProcess.getUrls()
   await fetch(cortexHttpUnloadModelUrl(modelId), {
    method: 'POST',
   });
  return Promise.resolve()
}

/**
 * Initializes a Cortex subprocess to load a machine learning model.
 * @param wrapper - The model wrapper.
 * @returns A Promise that resolves when the model is loaded successfully, or rejects with an error message if the model is not found or fails to load.
 */
async function loadModel(
  params: ModelInitOptions,
  systemInfo?: SystemInformation
): Promise<ModelOperationResponse | void> {
    const isSupportedEngine = [
        InferenceEngine.cortex_llamacpp,
        InferenceEngine.cortex_onnx,
        InferenceEngine.cortex_tensorrtllm,
    ]
  console.log('params.model.engine', params.model.engine)
  if (!isSupportedEngine.includes(params.model.engine)) {
    // Not a cortex model
    return Promise.resolve()
  }
   
    const resourceProbe = await getSystemResourceInfo()
    // Convert settings.prompt_template to system_prompt, user_prompt, ai_prompt
    if (params.model.settings.prompt_template) {
      const promptTemplate = params.model.settings.prompt_template
      const prompt = promptTemplateConverter(promptTemplate)
      if (prompt?.error) {
        return Promise.reject(prompt.error)
      }
      params.model.settings.system_prompt = prompt.system_prompt
      params.model.settings.user_prompt = prompt.user_prompt
      params.model.settings.ai_prompt = prompt.ai_prompt
    }

    // modelFolder is the absolute path to the running model folder
    // e.g. ~/jan/models/llama-2
    let modelFolder = params.modelFolder

    let llama_model_path = params.model.settings.llama_model_path

    // Absolute model path support
    if (
      params.model?.sources.length &&
      params.model.sources.every((e) => fs.existsSync(e.url))
    ) {
      llama_model_path =
        params.model.sources.length === 1
          ? params.model.sources[0].url
          : params.model.sources.find((e) =>
              e.url.includes(llama_model_path ?? params.model.id)
            )?.url
    }

    if (!llama_model_path || !path.isAbsolute(llama_model_path)) {
      // Look for GGUF model file
      const modelFiles: string[] = fs.readdirSync(modelFolder)
      const ggufBinFile = modelFiles.find(
        (file) =>
          // 1. Prioritize llama_model_path (predefined)
          (llama_model_path && file === llama_model_path) ||
          // 2. Prioritize GGUF File (manual import)
          file.toLowerCase().includes(SUPPORTED_MODEL_FORMAT) ||
          // 3. Fallback Model ID (for backward compatibility)
          file === params.model.id
      )
      if (ggufBinFile) llama_model_path = path.join(modelFolder, ggufBinFile)
    }

    // Look for absolute source path for single model

    if (!llama_model_path) return Promise.reject('No GGUF model file found')

    currentSettings = {
      cpu_threads: Math.max(1, resourceProbe.numCpuPhysicalCore),
      // model.settings can override the default settings
      ...params.model.settings,
      llama_model_path,
      model: params.model.id,
      // This is critical and requires real CPU physical core count (or performance core)
      ...(params.model.settings.mmproj && {
        mmproj: path.isAbsolute(params.model.settings.mmproj)
          ? params.model.settings.mmproj
          : path.join(modelFolder, params.model.settings.mmproj),
      }),
    }

    if([InferenceEngine.cortex_onnx, InferenceEngine.cortex_tensorrtllm].includes(params.model.engine)){
      const engineInfo = await getEngineInformation(params.model.engine)
      if(engineInfo.status === EngineStatus.NOT_SUPPORTED){
          console.log('Engine not compatible', `Engine ${params.model.engine} is not compatible with the current system`)
      }

      if(engineInfo.status === EngineStatus.NOT_INITIALIZED){
        throw new Error('EXTENSION_IS_NOT_INSTALLED::Cortex extension with engine ' + params.model.engine)
      }

      if(engineInfo.status !== EngineStatus.ERROR){
        console.log('Engine error', `Unable to load engine ${params.model.engine}`)
      }
    }
    console.log('currentSettings', currentSettings)
    await spawnCortexProcess(systemInfo)
    console.log('loadLLMModel', params.model.id, currentSettings)
    await loadLLMModel(params.model.id, currentSettings)
    return;
}

/**
 * Parse prompt template into agrs settings
 * @param promptTemplate Template as string
 * @returns
 */
function promptTemplateConverter(promptTemplate: string): PromptTemplate {
  // Split the string using the markers
  const systemMarker = '{system_message}'
  const promptMarker = '{prompt}'

  if (
    promptTemplate.includes(systemMarker) &&
    promptTemplate.includes(promptMarker)
  ) {
    // Find the indices of the markers
    const systemIndex = promptTemplate.indexOf(systemMarker)
    const promptIndex = promptTemplate.indexOf(promptMarker)

    // Extract the parts of the string
    const system_prompt = promptTemplate.substring(0, systemIndex)
    const user_prompt = promptTemplate.substring(
      systemIndex + systemMarker.length,
      promptIndex
    )
    const ai_prompt = promptTemplate.substring(
      promptIndex + promptMarker.length
    )

    // Return the split parts
    return { system_prompt, user_prompt, ai_prompt }
  } else if (promptTemplate.includes(promptMarker)) {
    // Extract the parts of the string for the case where only promptMarker is present
    const promptIndex = promptTemplate.indexOf(promptMarker)
    const user_prompt = promptTemplate.substring(0, promptIndex)
    const ai_prompt = promptTemplate.substring(
      promptIndex + promptMarker.length
    )

    // Return the split parts
    return { user_prompt, ai_prompt }
  }

  // Return an error if none of the conditions are met
  return { error: 'Cannot split prompt template' }
}

/**
 * Loads a LLM model into the Cortex subprocess by sending a HTTP POST request.
 * @returns A Promise that resolves when the model is loaded successfully, or rejects with an error message if the model is not found or fails to load.
 */
function loadLLMModel(modelId: string, settings: any): Promise<Response> {
  const { cortexHttpLoadModelUrl } = cortexProcess.getUrls()
  if (!settings?.ngl) {
    settings.ngl = 100
  }
  const modelsPath = join(getJanDataFolderPath(), 'models')
  const metadataPath = join(modelsPath, modelId, 'model.json')
  const ggufPath = join(modelsPath, modelId, 'model.gguf')

  log(`[CORTEX]::Debug: Loading model with params ${JSON.stringify({
    ...settings,
    filePath: ggufPath,
    metadataPath,
  })}`)
  return fetchRetry(cortexHttpLoadModelUrl(modelId), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...settings,
      filePath: ggufPath,
      metadataPath,
    }),
    retries: 3,
    retryDelay: 300,
  })
    .then((res) => {
      log(
        `[CORTEX]::Debug: Load model success with response ${JSON.stringify(
          res
        )}`
      )
      return Promise.resolve(res)
    })
    .catch((err) => {
      log(`[CORTEX]::Error: Load model failed with error ${err}`)
      return Promise.reject(err)
    })
}

/**
 * Terminates the Cortex subprocess.
 * @returns A Promise that resolves when the subprocess is terminated successfully, or rejects with an error message if the subprocess fails to terminate.
 */
async function killSubprocess(): Promise<void> {
  const controller = new AbortController()
  setTimeout(() => controller.abort(), 5000)
  log(`[CORTEX]::Debug: Request to kill cortex`)
  await cortexProcessInstance.close();
}

/**
 * Spawns a Cortex subprocess.
 * @returns A promise that resolves when the Cortex subprocess is started.
 */
async function spawnCortexProcess(systemInfo?: SystemInformation): Promise<any> {
  const { start: startCortex } = await import('cortexso')
    const isCortexRunning = await getHealthCheckCortexProcess()
    if (isCortexRunning) {
        log(`[CORTEX]::Debug: Cortex subprocess is already running`)
        return Promise.resolve()
    }
    log(`[CORTEX]::Debug: Spawning cortex subprocess...`)
    cortexProcessInstance = await startCortex('jan', cortexProcess.host, cortexProcess.port, cortexProcess.enginePort, getJanDataFolderPath())
    log(`[CORTEX]::Debug: Cortex subprocess started`)
    await initCortexEngine(InferenceEngine.cortex_llamacpp, {
        runMode: systemInfo?.gpuSetting?.run_mode === 'gpu' ? 'GPU' : 'CPU',
        vulkan: systemInfo?.gpuSetting?.vulkan ?? false,
        gpuType: systemInfo?.gpuSetting?.vulkan ? 'Others (Vulkan)' : 'Nvidia',
    })
    return Promise.resolve()
}

async function initCortexEngine(engineName: string, options: InitEngineOptions): Promise<void> {
    const engineInfo = await getEngineInformation(engineName);
    console.log('options', options)
    if(engineInfo.status === 'not_supported'){
        log(`[CORTEX]::Error: Engine ${engineName} is not supported`)
        return Promise.reject(`Engine ${engineName} is not supported`)
    }
    if(engineInfo.status === 'ready'){
        log(`[CORTEX]::Debug: Engine ${engineName} is already initialized`)
        return Promise.resolve()
    }
    log(`[CORTEX]::Debug: Initializing cortex engine...`)
    const { cortexInitEngineUrl } = cortexProcess.getUrls()
   await fetchRetry(cortexInitEngineUrl(engineName), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(options || {}),
    retries: 3,
    retryDelay: 300,
})
}

async function getEngineInformation(engineName: string): Promise<EngineInformation> {
    const { cortexEngineInfo } = cortexProcess.getUrls()
    log(`[CORTEX]::Debug: Fetching engine information for ${engineName}`)
    const engineInfo = await fetch(cortexEngineInfo(engineName));
    log(`[CORTEX]::Debug: Engine information fetched with status:`, engineInfo.status)
    const engineInfoJson = await engineInfo.json();
    return engineInfoJson as EngineInformation;
}

/**
 * Every module should have a dispose function
 * This will be called when the extension is unloaded and should clean up any resources
 * Also called when app is closed
 */
function dispose() {
    killSubprocess()
}

/**
 * Get the current Cortex process info
 */

const getHealthCheckCortexProcess = async (): Promise<boolean> => {
    try{
      const { cortexHealthCheckUrl } = cortexProcess.getUrls()
    const health = await fetchRetry(cortexHealthCheckUrl, {
        method: 'GET',
        retries: 3,
    retryDelay: 300,
        })
 return health.ok
} catch (err) {
    return false;
}
}

const getEngineDownloadProgressUrl = () => {
    return cortexProcess.getUrls().cortexEngineDownloadEvent
}

const abortCortexEngineDownload = async (downloadIds: string[]) => {
  log(`[CORTEX]::Debug: Aborting download for ${downloadIds}`)
  const { cortexAbortDownload } = cortexProcess.getUrls()
  await Promise.all(downloadIds.map(async (downloadId) => fetch(cortexAbortDownload(downloadId), {
    method: 'DELETE',
  })))
  log(`[CORTEX]::Debug: Download aborted for ${downloadIds}`)
}

export default {
  loadModel,
  unloadModel,
  dispose,
  getEngineInformation,
  spawnCortexProcess,
  killSubprocess,
  initCortexEngine,
  getEngineDownloadProgressUrl,
  setPort,
  setHost,
  setEnginePort,
  abortCortexEngineDownload
}
