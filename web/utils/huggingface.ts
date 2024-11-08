import { AllQuantizations, getFileSize, HuggingFaceRepoData } from '@janhq/core'

/**
 * Fetches data from a Hugging Face repository.
 *
 * @param repoId - The ID of the Hugging Face repository.
 * @param huggingFaceAccessToken - Optional access token for Hugging Face API.
 * @returns A promise that resolves to the HuggingFaceRepoData.
 * @throws Will throw an error if the repository is not supported or if there is an error in the response.
 */
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

/**
 * Converts a repository ID or URL to a valid Hugging Face API URL.
 *
 * @param repoId - The repository ID or URL to convert.
 * @returns A string representing the Hugging Face API URL.
 * @throws {InvalidHostError} If the URL is invalid or not from huggingface.co.
 * @throws {Error} If the URL cannot be parsed.
 */
export function toHuggingFaceUrl(repoId: string): string {
  try {
    // Attempt to create a URL object from the repoId
    const url = new URL(repoId)

    // Check if the host is huggingface.co
    if (url.host !== 'huggingface.co') {
      throw new InvalidHostError(`Invalid Hugging Face repo URL: ${repoId}`)
    }

    // Split the pathname into parts and filter out empty strings
    const paths = url.pathname.split('/').filter((e) => e.trim().length > 0)

    // Ensure there are at least two parts in the path (user/repo)
    if (paths.length < 2) {
      throw new InvalidHostError(`Invalid Hugging Face repo URL: ${repoId}`)
    }

    // Construct and return the API URL
    return `${url.origin}/api/models/${paths[0]}/${paths[1]}`
  } catch (err) {
    // Re-throw InvalidHostError if it was caught
    if (err instanceof InvalidHostError) {
      throw err
    }

    // If repoId starts with 'https' but couldn't be parsed, throw an error
    if (repoId.startsWith('https')) {
      throw new Error(`Cannot parse url: ${repoId}`)
    }

    // If repoId is not a URL, assume it's a valid repo ID and construct the API URL
    return `https://huggingface.co/api/models/${repoId}`
  }
}

/**
 * Error thrown when the host of a URL is invalid or not from huggingface.co.
 */
export class InvalidHostError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidHostError'
  }
}
