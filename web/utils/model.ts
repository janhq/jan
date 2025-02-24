/**
 * Extracts and normalizes the model ID from a given download URL.
 *
 * @param downloadUrl - The URL from which to extract the model ID.
 * @returns The extracted model ID, or the original URL if extraction fails.
 */
export const normalizeModelId = (downloadUrl: string): string => {
  return downloadUrl.split('/').pop() ?? downloadUrl
}

/**
 * Default models to recommend to users when they first open the app.
 * TODO: These will be replaced when we have a proper recommendation system 
 * AND cortexso repositories are updated with tags.
 */
export const manualRecommendationModel = [
  'cortexso/deepseek-r1',
  'cortexso/llama3.2',
]
