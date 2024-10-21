import { AllQuantizations, getFileSize, HuggingFaceRepoData } from '@janhq/core'

export const fetchHuggingFaceRepoData = async (
  repoId: string,
  huggingFaceAccessToken?: string
): Promise<HuggingFaceRepoData> => {
  const sanitizedUrl = toHuggingFaceUrl(repoId)
  console.debug('sanitizedUrl', sanitizedUrl)

  const headers: Record<string, string> = {
    Accept: 'application/json',
  }

  if (huggingFaceAccessToken && huggingFaceAccessToken.length > 0) {
    headers['Authorization'] = `Bearer ${huggingFaceAccessToken}`
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

  const promises: Promise<number>[] = []

  // fetching file sizes
  const url = new URL(sanitizedUrl)
  const paths = url.pathname.split('/').filter((e) => e.trim().length > 0)

  for (const sibling of data.siblings) {
    const downloadUrl = `https://huggingface.co/${paths[2]}/${paths[3]}/resolve/main/${sibling.rfilename}`
    sibling.downloadUrl = downloadUrl
    promises.push(getFileSize(downloadUrl))
  }

  const result = await Promise.all(promises)
  for (let i = 0; i < data.siblings.length; i++) {
    data.siblings[i].fileSize = result[i]
  }

  AllQuantizations.forEach((quantization) => {
    data.siblings.forEach((sibling) => {
      if (!sibling.quantization && sibling.rfilename.includes(quantization)) {
        sibling.quantization = quantization
      }
    })
  })

  data.modelUrl = `https://huggingface.co/${paths[2]}/${paths[3]}`
  return data
}

export function toHuggingFaceUrl(repoId: string): string {
  try {
    const url = new URL(repoId)
    if (url.host !== 'huggingface.co') {
      throw new InvalidHostError(`Invalid Hugging Face repo URL: ${repoId}`)
    }

    const paths = url.pathname.split('/').filter((e) => e.trim().length > 0)
    if (paths.length < 2) {
      throw new InvalidHostError(`Invalid Hugging Face repo URL: ${repoId}`)
    }

    return `${url.origin}/api/models/${paths[0]}/${paths[1]}`
  } catch (err) {
    if (err instanceof InvalidHostError) {
      throw err
    }

    if (repoId.startsWith('https')) {
      throw new Error(`Cannot parse url: ${repoId}`)
    }

    return `https://huggingface.co/api/models/${repoId}`
  }
}
export class InvalidHostError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidHostError'
  }
}
