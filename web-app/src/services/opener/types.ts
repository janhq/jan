/**
 * Opener Service Types
 * Types for opening/revealing files and folders
 */

export interface OpenerService {
  revealItemInDir(path: string): Promise<void>
  /** Hand a local path to the OS default application for its type. */
  openPath(path: string): Promise<void>
}
