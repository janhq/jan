export const getBase64 = async (file: File): Promise<string> =>
  new Promise((resolve) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = () => {
      const baseURL = reader.result
      resolve(baseURL as string)
    }
  })

export function compressImage(
  base64Image: string,
  size: number
): Promise<string> {
  // Create a canvas element
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')

  // Create an image object
  const image = new Image()

  // Set the image source to the base64 string
  image.src = base64Image

  return new Promise((resolve) => {
    // Wait for the image to load
    image.onload = () => {
      // Set the canvas width and height to the image width and height
      const width = Math.min(size, image.width)
      const height = (image.height / image.width) * width

      canvas.width = width
      canvas.height = height

      // Draw the image on the canvas
      ctx?.drawImage(image, 0, 0, canvas.width, canvas.height)

      // Convert the canvas to a data URL with the specified quality
      const compressedBase64Image = canvas.toDataURL(`image/jpeg`, 1)

      // Log the compressed base64 image
      return resolve(compressedBase64Image)
    }
  })
}
