/**
 * General formatting utility functions
 */

/**
 * Format file size in human readable format
 */
export const formatFileSize = (bytes?: number): string => {
  if (!bytes || bytes === 0) return 'Unknown size'
  
  const units = ['Bytes', 'KB', 'MB', 'GB', 'TB']
  const k = 1024
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${units[i]}`
}

/**
 * Format date string to locale string
 */
export const formatDate = (dateString: string): string => {
  try {
    return new Date(dateString).toLocaleString()
  } catch {
    return 'Invalid date'
  }
}

/**
 * Format date string to relative time (e.g., "2 days ago")
 */
export const formatRelativeDate = (dateString: string): string => {
  try {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    
    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays} days ago`
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`
    return `${Math.floor(diffDays / 365)} years ago`
  } catch {
    return 'Unknown'
  }
}

/**
 * Extract file name from file path
 */
export const getFileNameFromPath = (filePath: string): string => {
  return filePath.split('/').pop() ?? 'Unknown file'
}

/**
 * Get file extension from file name
 */
export const getFileTypeFromName = (fileName: string): string => {
  const extension = fileName.toLowerCase().split('.').pop()
  return extension ?? 'unknown'
}

/**
 * Get error message from unknown error type
 */
export const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  return 'An unknown error occurred'
}