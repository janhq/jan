import {
  downloadFile,
  listFiles,
  listModels,
  ModelEntry,
} from '@huggingface/hub'
import {
  AllQuantizations,
  HuggingFaceRepoData,
  LlmEngine,
  Model,
  RemoteEngines,
} from '@janhq/core'
import { parse } from 'yaml'

import { markdownParser } from './markdown-parser'

/**
 * Try to find and read model.yml from main branch. This function is only used for HuggingFace.
 */
export const tryGettingModelYaml = async (
  repoName: string,
  branch?: string
): Promise<Model | undefined> => {
  const revision = branch ?? 'main'
  try {
    for await (const fileInfo of listFiles({
      repo: { type: 'model', name: repoName },
      revision,
    })) {
      if (fileInfo.path !== 'model.yml') continue

      const data = await (
        await downloadFile({
          repo: repoName,
          revision,
          path: fileInfo.path,
        })
      )?.text()

      if (!data) return undefined
      return parse(data) as Model
    }
  } catch (e) {
    console.debug('Cannot get model info for', repoName, e)
    return undefined
  }
}

export const fetchHuggingFaceModel = async (
  owner: string,
  modelName: string
): Promise<HfModelEntry[]> => {
  const ownerAndModelName = `${owner}/${modelName}`
  const result: HfModelEntry[] = []

  for await (const model of listModels({
    search: {
      query: ownerAndModelName,
      owner: owner,
    },
  })) {
    result.push({
      ...model,
    })
  }
  return result
}

export const fetchCortexHubModelEntries = async (): Promise<HfModelEntry[]> => {
  const modelEntries: HfModelEntry[] = []

  for await (const model of listModels({
    search: { query: 'cortexso' },
  })) {
    modelEntries.push({
      ...model,
    })
  }

  return modelEntries
}

export const listCortexHubModels = async (): Promise<HfModelEntry[]> => {
  const modelEntries = await fetchCortexHubModelEntries()
  const promises: Promise<Model | undefined>[] = []
  modelEntries.forEach((model) => {
    promises.push(tryGettingModelYaml(model.name))
  })

  const modelData = await Promise.allSettled(promises)
  for (let i = 0; i < modelEntries.length; i++) {
    if (modelData[i].status === 'fulfilled') {
      const fulfillResult = modelData[i] as PromiseFulfilledResult<
        Model | undefined
      >

      const model: Model = fulfillResult.value as Model
      if (model) {
        modelEntries[i].model = model
        modelEntries[i].remoteModel =
          RemoteEngines.find((engine) => model.engine === engine) != null
        modelEntries[i].engine = model.engine
      }
    }
  }

  return modelEntries
}

export const getBranches = async (name: string): Promise<string[]> => {
  try {
    const response = await fetch(
      `https://huggingface.co/api/models/${name}/refs`
    )
    const data = await response.json()
    return data.branches.map((branch: { name: string }) => branch.name)
  } catch (err) {
    console.error('Failed to get HF branches:', err)
    return []
  }
}

export const getEngineAndBranches = async (
  name: string
): Promise<EngineToBranches> => {
  const branches = await getBranches(name)
  const engineToBranches: EngineToBranches = {
    onnx: [],
    gguf: [],
    tensorrtllm: [],
  }

  branches.forEach((branch) => {
    if (branch.includes('onnx')) {
      engineToBranches.onnx.push(branch)
      return
    }

    if (branch.includes('gguf')) {
      engineToBranches.gguf.push(branch)
      return
    }
    if (branch.includes('tensorrtllm')) {
      engineToBranches.tensorrtllm.push(branch)
      return
    }
  })
  return engineToBranches
}

export const tryGettingReadMeFile = async (
  repoName: string,
  branch?: string
): Promise<string | undefined> => {
  const revision = branch ?? 'main'
  try {
    for await (const fileInfo of listFiles({
      repo: { type: 'model', name: repoName },
      revision,
    })) {
      if (fileInfo.path !== 'README.md') continue

      const data = await (
        await downloadFile({
          repo: repoName,
          revision,
          path: fileInfo.path,
        })
      )?.text()

      if (!data) return undefined
      return markdownParser.parse(data)
    }
  } catch (e) {
    console.debug('Cannot get ReadMe for', repoName, e)
    return undefined
  }
}

const toHuggingFaceUrl = (repoId: string): string => {
  try {
    const url = new URL(repoId)
    if (url.host !== 'huggingface.co') {
      throw new Error(`Invalid Hugging Face repo URL: ${repoId}`)
    }

    const paths = url.pathname.split('/').filter((e) => e.trim().length > 0)
    if (paths.length < 2) {
      throw new Error(`Invalid Hugging Face repo URL: ${repoId}`)
    }

    return `${url.origin}/api/models/${paths[0]}/${paths[1]}`
  } catch (err) {
    if (repoId.startsWith('https')) {
      throw new Error(`Cannot parse url: ${repoId}`)
    }

    return `https://huggingface.co/api/models/${repoId}`
  }
}

export const fetchHuggingFaceRepoData = async (
  repoId: string
): Promise<HuggingFaceRepoData> => {
  const sanitizedUrl = toHuggingFaceUrl(repoId)
  console.debug('sanitizedUrl', sanitizedUrl)

  const headers = {
    Accept: 'application/json',
  }

  const res = await fetch(sanitizedUrl, {
    headers: headers,
  })
  const response = await res.json()
  if (response['error'] != null) {
    throw new Error(response['error'])
  }

  const data = response as HuggingFaceRepoData

  if (data.tags.indexOf('gguf') === -1) {
    throw new Error(
      `${repoId} is not supported. Only GGUF models are supported.`
    )
  }

  const url = new URL(sanitizedUrl)
  const paths = url.pathname.split('/').filter((e) => e.trim().length > 0)

  for (const sibling of data.siblings) {
    const downloadUrl = `https://huggingface.co/${paths[2]}/${paths[3]}/resolve/main/${sibling.rfilename}`
    sibling.downloadUrl = downloadUrl
  }
  for await (const fileInfo of listFiles({
    repo: { type: 'model', name: repoId },
  })) {
    const sibling = data.siblings.find(
      (sibling) => sibling.rfilename === fileInfo.path
    )
    if (sibling) {
      sibling.fileSize = fileInfo.size
    }
  }

  AllQuantizations.forEach((quantization) => {
    data.siblings.forEach((sibling) => {
      if (!sibling.quantization && sibling.rfilename.includes(quantization)) {
        sibling.quantization = quantization
      }
    })
  })
  data.siblings = data.siblings.filter(
    (sibling) => sibling.quantization != null
  )

  data.modelUrl = `https://huggingface.co/${paths[2]}/${paths[3]}`
  return data
}

// TODO: move this to somewhere else
export interface HfModelEntry extends ModelEntry {
  model?: Model // TODO: deprecated this
  remoteModel?: boolean
  engine?: LlmEngine
}

export type EngineType = 'onnx' | 'gguf' | 'tensorrtllm'

export type EngineToBranches = Record<EngineType, string[]>
