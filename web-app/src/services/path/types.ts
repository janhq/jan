/**
 * Path Service Types  
 * Types for filesystem path operations
 */

export interface PathService {
  sep(): string
  join(...segments: string[]): Promise<string>
  dirname(path: string): Promise<string>
  basename(path: string): Promise<string>
  extname(path: string): Promise<string>
}
