/**
 * This utility is to extract cortexso model description from README.md file
 * @returns
 */
export const extractDescription = (text: string) => {
  const overviewPattern = /(?:##\s*Overview\s*\n)([\s\S]*?)(?=\n\s*##|$)/
  const matches = text.match(overviewPattern)
  if (matches && matches[1]) {
    return matches[1].trim()
  }
  return
}
