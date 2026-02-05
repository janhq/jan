/**
 * Opener Service Types
 * Types for opening/revealing files and folders
 */

export interface OpenerService {
  revealItemInDir(path: string): Promise<void>
}
