/**
 * Opener Service Types
 * Types for opening/revealing files and folders
 */

export interface OpenerService {
  /** Select the item inside its parent folder. For opening a folder itself, use
   * `openPath` — revealing a directory shows its parent, not its contents. */
  revealItemInDir(path: string): Promise<void>
  /** Hand a local path to the OS default application for its type; a folder
   * opens in the file manager. */
  openPath(path: string): Promise<void>
}
