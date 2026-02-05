/**
 * Dialog Service Types
 * Types for file/folder dialog operations
 */

export interface DialogOpenOptions {
  multiple?: boolean
  directory?: boolean
  defaultPath?: string
  filters?: Array<{
    name: string
    extensions: string[]
  }>
}

export interface DialogService {
  open(options?: DialogOpenOptions): Promise<string | string[] | null>
  save(options?: DialogOpenOptions): Promise<string | null>
}
