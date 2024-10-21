export const normalizeModelId = (downloadUrl: string): string => {
  return downloadUrl.split('/').pop() ?? downloadUrl
}
