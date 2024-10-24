/**
 * Extracts and normalizes the model ID from a given download URL.
 *
 * @param downloadUrl - The URL from which to extract the model ID.
 * @returns The extracted model ID, or the original URL if extraction fails.
 */
export const normalizeModelId = (downloadUrl: string): string => {
  return downloadUrl.split('/').pop() ?? downloadUrl
}
