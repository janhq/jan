/**
 * This utility is to extract cortexso model description from README.md file
 * @returns
 */
export const extractDescription = (text?: string) => {
  if (!text) return text
  const overviewPattern = /(?:##\s*Overview\s*\n)([\s\S]*?)(?=\n\s*##|$)/
  const matches = text?.match(overviewPattern)
  if (matches && matches[1]) {
    return matches[1].trim()
  }
  return
}

/**
 * Extract model name from repo path, e.g. cortexso/tinyllama -> tinyllama
 * @param modelId
 * @returns
 */
export const extractModelName = (modelId?: string) => {
  return modelId?.split('/')[1] ?? modelId
}
