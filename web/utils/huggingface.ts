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

export const fetchCortexHubModels = async (): Promise<HfModelEntry[]> => {
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
        if (model.model_type === 'embedding') continue
        modelEntries[i].model = model
        const isRemoteModel =
          RemoteEngines.find((engine) => model.engine === engine) != null
        modelEntries[i].remoteModel = isRemoteModel
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

/**
 * Getting the total file size of a repo by repoId and branch. This will get all file size.
 * So this function can't be used on a multiple model branch.
 *
 * @param repoId The repoId of the model
 * @param branch The branch of the model
 * @returns The total file size of the model
 */
const getFileSizeByRepoAndBranch = async (
  repoId: string,
  branch: string
): Promise<number> => {
  let number = 0
  for await (const fileInfo of listFiles({
    repo: { type: 'model', name: repoId },
    revision: branch,
  })) {
    number += fileInfo.size
  }

  return number
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

  for (const branch of branches) {
    if (branch.includes('onnx')) {
      const fileSize = await getFileSizeByRepoAndBranch(name, branch)
      engineToBranches.onnx.push({
        name: branch,
        fileSize: fileSize,
      })
      continue
    }
    if (branch.includes('gguf')) {
      const fileSize = await getFileSizeByRepoAndBranch(name, branch)
      engineToBranches.gguf.push({
        name: branch,
        fileSize: fileSize,
      })
      continue
    }
    if (branch.includes('tensorrt-llm')) {
      const mergedBranchName = branch.split('-').slice(0, -2).join('-')
      let isAlreadyAdded = false
      // check if the branch is already added
      for (const branch of engineToBranches.tensorrtllm) {
        if (branch.name.includes(mergedBranchName)) {
          isAlreadyAdded = true
          break
        }
      }
      if (!isAlreadyAdded) {
        const fileSize = await getFileSizeByRepoAndBranch(name, branch)
        engineToBranches.tensorrtllm.push({
          name: mergedBranchName,
          fileSize: fileSize,
        })
      }
      continue
    }
  }

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

export const getFileSize = async (url: string) => {
  try {
    const response = await fetch(url, { method: 'HEAD' })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const contentLength = response.headers.get('Content-Length')

    if (contentLength) {
      return parseInt(contentLength, 10)
    } else {
      throw new Error('Content-Length header is missing')
    }
  } catch (error) {
    console.error('Error fetching file size:', error)
    return null
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
  const sanitizedRepoId = `${paths[2]}/${paths[3]}`

  for (const sibling of data.siblings) {
    const downloadUrl = `https://huggingface.co/${sanitizedRepoId}/resolve/main/${sibling.rfilename}`
    sibling.downloadUrl = downloadUrl
  }
  for await (const fileInfo of listFiles({
    repo: { type: 'model', name: sanitizedRepoId },
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
      if (
        !sibling.quantization &&
        (sibling.rfilename.includes(quantization) ||
          sibling.rfilename.includes(quantization.toLowerCase()))
      ) {
        sibling.quantization = quantization
      }
    })
  })
  data.siblings = data.siblings
    .filter((sibling) => sibling.quantization != null)
    .filter((sibling) => sibling.fileSize != null)

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

export type EngineToBranches = Record<EngineType, CortexHubModel[]>

export type CortexHubModel = {
  name: string
  fileSize?: number
}
