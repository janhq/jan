import fs from 'fs'
import { join } from 'path'
import { getJanDataFolderPath, getJanExtensionsPath, getSystemResourceInfo } from '../../../helper'
import { logServer } from '../../../helper/log'
import { ChildProcessWithoutNullStreams, spawn } from 'child_process'
import { Model, ModelSettingParams, PromptTemplate } from '../../../../types'
import {
  LOCAL_HOST,
  NITRO_DEFAULT_PORT,
  NITRO_HTTP_KILL_URL,
  NITRO_HTTP_LOAD_MODEL_URL,
  NITRO_HTTP_VALIDATE_MODEL_URL,
  SUPPORTED_MODEL_FORMAT,
} from './consts'

// The subprocess instance for Nitro
let subprocess: ChildProcessWithoutNullStreams | undefined = undefined

// TODO: move this to core type
interface NitroModelSettings extends ModelSettingParams {
  llama_model_path: string
  cpu_threads: number
}

export const startModel = async (modelId: string, settingParams?: ModelSettingParams) => {
  try {
    await runModel(modelId, settingParams)

    return {
      message: `Model ${modelId} started`,
    }
  } catch (e) {
    return {
      error: e,
    }
  }
}

const runModel = async (modelId: string, settingParams?: ModelSettingParams): Promise<void> => {
  const janDataFolderPath = getJanDataFolderPath()
  const modelFolderFullPath = join(janDataFolderPath, 'models', modelId)

  if (!fs.existsSync(modelFolderFullPath)) {
    throw `Model not found: ${modelId}`
  }

  const files: string[] = fs.readdirSync(modelFolderFullPath)

  // Look for GGUF model file
  const ggufBinFile = files.find((file) => file.toLowerCase().includes(SUPPORTED_MODEL_FORMAT))

  const modelMetadataPath = join(modelFolderFullPath, 'model.json')
  const modelMetadata: Model = JSON.parse(fs.readFileSync(modelMetadataPath, 'utf-8'))

  if (!ggufBinFile) {
    throw 'No GGUF model file found'
  }
  const modelBinaryPath = join(modelFolderFullPath, ggufBinFile)

  const nitroResourceProbe = await getSystemResourceInfo()
  const nitroModelSettings: NitroModelSettings = {
    ...modelMetadata.settings,
    ...settingParams,
    llama_model_path: modelBinaryPath,
    // This is critical and requires real CPU physical core count (or performance core)
    cpu_threads: Math.max(1, nitroResourceProbe.numCpuPhysicalCore),
    ...(modelMetadata.settings.mmproj && {
      mmproj: join(modelFolderFullPath, modelMetadata.settings.mmproj),
    }),
  }

  logServer(`[NITRO]::Debug: Nitro model settings: ${JSON.stringify(nitroModelSettings)}`)

  // Convert settings.prompt_template to system_prompt, user_prompt, ai_prompt
  if (modelMetadata.settings.prompt_template) {
    const promptTemplate = modelMetadata.settings.prompt_template
    const prompt = promptTemplateConverter(promptTemplate)
    if (prompt?.error) {
      return Promise.reject(prompt.error)
    }
    nitroModelSettings.system_prompt = prompt.system_prompt
    nitroModelSettings.user_prompt = prompt.user_prompt
    nitroModelSettings.ai_prompt = prompt.ai_prompt
  }

  await runNitroAndLoadModel(modelId, nitroModelSettings)
}

// TODO: move to util
const promptTemplateConverter = (promptTemplate: string): PromptTemplate => {
  // Split the string using the markers
  const systemMarker = '{system_message}'
  const promptMarker = '{prompt}'

  if (promptTemplate.includes(systemMarker) && promptTemplate.includes(promptMarker)) {
    // Find the indices of the markers
    const systemIndex = promptTemplate.indexOf(systemMarker)
    const promptIndex = promptTemplate.indexOf(promptMarker)

    // Extract the parts of the string
    const system_prompt = promptTemplate.substring(0, systemIndex)
    const user_prompt = promptTemplate.substring(systemIndex + systemMarker.length, promptIndex)
    const ai_prompt = promptTemplate.substring(promptIndex + promptMarker.length)

    // Return the split parts
    return { system_prompt, user_prompt, ai_prompt }
  } else if (promptTemplate.includes(promptMarker)) {
    // Extract the parts of the string for the case where only promptMarker is present
    const promptIndex = promptTemplate.indexOf(promptMarker)
    const user_prompt = promptTemplate.substring(0, promptIndex)
    const ai_prompt = promptTemplate.substring(promptIndex + promptMarker.length)

    // Return the split parts
    return { user_prompt, ai_prompt }
  }

  // Return an error if none of the conditions are met
  return { error: 'Cannot split prompt template' }
}

const runNitroAndLoadModel = async (modelId: string, modelSettings: NitroModelSettings) => {
  // Gather system information for CPU physical cores and memory
  const tcpPortUsed = require('tcp-port-used')

  await stopModel(modelId)
  await tcpPortUsed.waitUntilFree(NITRO_DEFAULT_PORT, 300, 5000)

  /**
   * There is a problem with Windows process manager
   * Should wait for awhile to make sure the port is free and subprocess is killed
   * The tested threshold is 500ms
   **/
  if (process.platform === 'win32') {
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  await spawnNitroProcess()
  await loadLLMModel(modelSettings)
  await validateModelStatus()
}

const spawnNitroProcess = async (): Promise<void> => {
  logServer(`[NITRO]::Debug: Spawning Nitro subprocess...`)

  let binaryFolder = join(
    getJanExtensionsPath(),
    '@janhq',
    'inference-nitro-extension',
    'dist',
    'bin'
  )

  let executableOptions = executableNitroFile()
  const tcpPortUsed = require('tcp-port-used')

  const args: string[] = ['1', LOCAL_HOST, NITRO_DEFAULT_PORT.toString()]
  // Execute the binary
  logServer(
    `[NITRO]::Debug: Spawn nitro at path: ${executableOptions.executablePath}, and args: ${args}`
  )
  subprocess = spawn(
    executableOptions.executablePath,
    ['1', LOCAL_HOST, NITRO_DEFAULT_PORT.toString()],
    {
      cwd: binaryFolder,
      env: {
        ...process.env,
        CUDA_VISIBLE_DEVICES: executableOptions.cudaVisibleDevices,
      },
    }
  )

  // Handle subprocess output
  subprocess.stdout.on('data', (data: any) => {
    logServer(`[NITRO]::Debug: ${data}`)
  })

  subprocess.stderr.on('data', (data: any) => {
    logServer(`[NITRO]::Error: ${data}`)
  })

  subprocess.on('close', (code: any) => {
    logServer(`[NITRO]::Debug: Nitro exited with code: ${code}`)
    subprocess = undefined
  })

  tcpPortUsed.waitUntilUsed(NITRO_DEFAULT_PORT, 300, 30000).then(() => {
    logServer(`[NITRO]::Debug: Nitro is ready`)
  })
}

type NitroExecutableOptions = {
  executablePath: string
  cudaVisibleDevices: string
}

const executableNitroFile = (): NitroExecutableOptions => {
  const nvidiaInfoFilePath = join(getJanDataFolderPath(), 'settings', 'settings.json')
  let binaryFolder = join(
    getJanExtensionsPath(),
    '@janhq',
    'inference-nitro-extension',
    'dist',
    'bin'
  )

  let cudaVisibleDevices = ''
  let binaryName = 'nitro'
  /**
   * The binary folder is different for each platform.
   */
  if (process.platform === 'win32') {
    /**
     *  For Windows: win-cpu, win-cuda-11-7, win-cuda-12-0
     */
    let nvidiaInfo = JSON.parse(fs.readFileSync(nvidiaInfoFilePath, 'utf-8'))
    if (nvidiaInfo['run_mode'] === 'cpu') {
      binaryFolder = join(binaryFolder, 'win-cpu')
    } else {
      if (nvidiaInfo['cuda'].version === '12') {
        binaryFolder = join(binaryFolder, 'win-cuda-12-0')
      } else {
        binaryFolder = join(binaryFolder, 'win-cuda-11-7')
      }
      cudaVisibleDevices = nvidiaInfo['gpu_highest_vram']
    }
    binaryName = 'nitro.exe'
  } else if (process.platform === 'darwin') {
    /**
     *  For MacOS: mac-arm64 (Silicon), mac-x64 (InteL)
     */
    if (process.arch === 'arm64') {
      binaryFolder = join(binaryFolder, 'mac-arm64')
    } else {
      binaryFolder = join(binaryFolder, 'mac-x64')
    }
  } else {
    /**
     *  For Linux: linux-cpu, linux-cuda-11-7, linux-cuda-12-0
     */
    let nvidiaInfo = JSON.parse(fs.readFileSync(nvidiaInfoFilePath, 'utf-8'))
    if (nvidiaInfo['run_mode'] === 'cpu') {
      binaryFolder = join(binaryFolder, 'linux-cpu')
    } else {
      if (nvidiaInfo['cuda'].version === '12') {
        binaryFolder = join(binaryFolder, 'linux-cuda-12-0')
      } else {
        binaryFolder = join(binaryFolder, 'linux-cuda-11-7')
      }
      cudaVisibleDevices = nvidiaInfo['gpu_highest_vram']
    }
  }

  return {
    executablePath: join(binaryFolder, binaryName),
    cudaVisibleDevices,
  }
}

const validateModelStatus = async (): Promise<void> => {
  // Send a GET request to the validation URL.
  // Retry the request up to 3 times if it fails, with a delay of 500 milliseconds between retries.
  const fetchRT = require('fetch-retry')
  const fetchRetry = fetchRT(fetch)

  return fetchRetry(NITRO_HTTP_VALIDATE_MODEL_URL, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    retries: 5,
    retryDelay: 500,
  }).then(async (res: Response) => {
    logServer(`[NITRO]::Debug: Validate model state success with response ${JSON.stringify(res)}`)
    // If the response is OK, check model_loaded status.
    if (res.ok) {
      const body = await res.json()
      // If the model is loaded, return an empty object.
      // Otherwise, return an object with an error message.
      if (body.model_loaded) {
        return Promise.resolve()
      }
    }
    return Promise.reject('Validate model status failed')
  })
}

const loadLLMModel = async (settings: NitroModelSettings): Promise<Response> => {
  logServer(`[NITRO]::Debug: Loading model with params ${JSON.stringify(settings)}`)
  const fetchRT = require('fetch-retry')
  const fetchRetry = fetchRT(fetch)

  return fetchRetry(NITRO_HTTP_LOAD_MODEL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(settings),
    retries: 3,
    retryDelay: 500,
  })
    .then((res: any) => {
      logServer(`[NITRO]::Debug: Load model success with response ${JSON.stringify(res)}`)
      return Promise.resolve(res)
    })
    .catch((err: any) => {
      logServer(`[NITRO]::Error: Load model failed with error ${err}`)
      return Promise.reject(err)
    })
}

/**
 * Stop model and kill nitro process.
 */
export const stopModel = async (_modelId: string) => {
  if (!subprocess) {
    return {
      error: "Model isn't running",
    }
  }
  return new Promise((resolve, reject) => {
    const controller = new AbortController()
    setTimeout(() => {
      controller.abort()
      reject({
        error: 'Failed to stop model: Timedout',
      })
    }, 5000)
    const tcpPortUsed = require('tcp-port-used')
    logServer(`[NITRO]::Debug: Request to kill Nitro`)

    fetch(NITRO_HTTP_KILL_URL, {
      method: 'DELETE',
      signal: controller.signal,
    })
      .then(() => {
        subprocess?.kill()
        subprocess = undefined
      })
      .catch(() => {
        // don't need to do anything, we still kill the subprocess
      })
      .then(() => tcpPortUsed.waitUntilFree(NITRO_DEFAULT_PORT, 300, 5000))
      .then(() => logServer(`[NITRO]::Debug: Nitro process is terminated`))
      .then(() =>
        resolve({
          message: 'Model stopped',
        })
      )
  })
}
