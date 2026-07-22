/**
 * A resolved @path reference in the chat input
 */
export type PathReference = {
  /** Unique ID for this reference chip */
  id: string
  /** The raw path string as typed/selected by the user */
  rawPath: string
  /** Full absolute path (resolved relative to working directory) */
  absolutePath: string
  /** Whether it's a file or directory */
  kind: 'file' | 'directory'
  /** Display name (basename of the path) */
  name: string
  /** File size in bytes (for files only) */
  size?: number
  /** Whether this reference encountered an error during resolution */
  error?: 'missing' | 'too_large' | 'unreadable'
  /** Error description */
  errorMessage?: string
}

/**
 * Entry shown in the fuzzy file picker
 */
export type FilePickerEntry = {
  path: string
  name: string
  kind: 'file' | 'directory'
  // Optional for display/styling
  extension?: string
}
