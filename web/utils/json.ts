export const safeJsonParse = <T>(str: string) => {
  try {
    const jsonValue: T = JSON.parse(str)

    return jsonValue
  } catch {
    return undefined
  }
}
