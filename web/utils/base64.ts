export const getBase64 = async (file: File): Promise<string> =>
  new Promise((resolve) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = () => {
      const baseURL = reader.result
      resolve(baseURL as string)
    }
  })
