/**
 * File handling utilities for upload functionality
 */

export type SupportedFileType = {
  name: string
  type: string
  size: number
  base64: string
  dataUrl: string
}

/**
 * File type mappings for extension to MIME type conversion
 */
const FILE_TYPE_MAP: Record<string, string> = {
  // Images
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  
  // Audio
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  
  // Documents
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
}

/**
 * Supported file types for validation
 */
const ALLOWED_FILE_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'audio/wav',
  'audio/mpeg',
  'audio/mp3',
  'audio/ogg',
  'audio/mp4',
  'audio/flac',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]

/**
 * Maximum file size in bytes (10MB)
 */
export const MAX_FILE_SIZE = 10 * 1024 * 1024

/**
 * Get MIME type from file extension
 */
export const getFileTypeFromExtension = (fileName: string): string => {
  const extension = fileName.toLowerCase().split('.').pop()
  return extension ? FILE_TYPE_MAP[extension] || '' : ''
}

/**
 * Validate if file type is supported
 */
export const isValidFileType = (mimeType: string): boolean => {
  return ALLOWED_FILE_TYPES.includes(mimeType)
}

/**
 * Validate if file size is within limits
 */
export const isValidFileSize = (size: number): boolean => {
  return size <= MAX_FILE_SIZE
}

/**
 * Get user-friendly error message for unsupported file types
 */
export const getUnsupportedFileTypeMessage = (): string => {
  return 'File is not supported. Supported formats: Images (JPEG, PNG, GIF, WebP), Audio (WAV, MP3, OGG, M4A, FLAC), Documents (PDF, DOC, DOCX, TXT).'
}

/**
 * Get user-friendly error message for oversized files
 */
export const getOversizedFileMessage = (): string => {
  return 'File is too large. Maximum size is 10MB.'
}

/**
 * Process a single file and convert to base64
 */
export const processFile = (file: File): Promise<SupportedFileType> => {
  return new Promise((resolve, reject) => {
    // Validate file size
    if (!isValidFileSize(file.size)) {
      reject(new Error(getOversizedFileMessage()))
      return
    }

    // Get file type - use extension as fallback if MIME type is incorrect
    const detectedType = file.type || getFileTypeFromExtension(file.name)
    const actualType = getFileTypeFromExtension(file.name) || detectedType

    // Validate file type
    if (!isValidFileType(actualType)) {
      reject(new Error(getUnsupportedFileTypeMessage()))
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === 'string') {
        const base64String = result.split(',')[1]
        resolve({
          name: file.name,
          size: file.size,
          type: actualType,
          base64: base64String,
          dataUrl: result,
        })
      } else {
        reject(new Error('Failed to read file'))
      }
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

/**
 * Process multiple files and return valid ones
 */
export const processFiles = async (files: FileList): Promise<SupportedFileType[]> => {
  const validFiles: SupportedFileType[] = []
  const errors: string[] = []

  for (const file of Array.from(files)) {
    try {
      const processedFile = await processFile(file)
      validFiles.push(processedFile)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Unknown error')
    }
  }

  // If there are errors and no valid files, throw the first error
  if (errors.length > 0 && validFiles.length === 0) {
    throw new Error(errors[0])
  }

  return validFiles
}

/**
 * Process clipboard images from a paste event
 */
export const processClipboardImages = async (clipboardData: DataTransfer): Promise<SupportedFileType[]> => {
  const items = Array.from(clipboardData.items)
  const imageItems = items.filter(item => item.type.startsWith('image/'))
  
  if (imageItems.length === 0) {
    return []
  }
  
  const imageFiles: File[] = []
  
  for (const item of imageItems) {
    const file = item.getAsFile()
    if (file) {
      // Create a new file with a meaningful name
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const extension = file.type.split('/')[1] || 'png'
      const newFile = new File([file], `pasted-image-${timestamp}.${extension}`, {
        type: file.type
      })
      imageFiles.push(newFile)
    }
  }

  if (imageFiles.length === 0) {
    return []
  }

  // Convert File[] to FileList-like object
  const fileList = {
    length: imageFiles.length,
    item: (index: number) => imageFiles[index],
    [Symbol.iterator]: function* () {
      for (let i = 0; i < this.length; i++) {
        yield this.item(i)
      }
    }
  } as FileList

  return processFiles(fileList)
}