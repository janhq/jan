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
  return text.replace(/_{1,}([ a-z0-9]+)_{1,}/gim, '<strong>$1</strong>').trim()
}

/**
 * Extract model name from repo path, e.g. cortexso/tinyllama -> tinyllama
 * @param modelId
 * @returns
 */
export const extractModelName = (model?: string) => {
  return model?.split('/')[1] ?? model
}

/**
 * Extract model name from repo path, e.g. https://huggingface.co/cortexso/tinyllama -> cortexso/tinyllama
 * @param modelId
 * @returns
 */
export const extractModelRepo = (model?: string) => {
  return model?.replace('https://huggingface.co/', '')
}
