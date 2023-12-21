// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const getBase64 = async (file: any): Promise<string> => {
  return new Promise((resolve, reject) => {
    let fileInfo
    // Make new FileReader
    const reader = new FileReader()

    // Convert the file to base64 text
    reader.readAsDataURL(file)

    // on reader load somthing...
    reader.onload = () => {
      // Make a fileInfo Object
      const baseURL = reader.result
      resolve(baseURL as string)
    }
  })
}
