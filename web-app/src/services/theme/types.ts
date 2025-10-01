/**
 * Theme Service Types
 */

export type ThemeMode = 'light' | 'dark' | null

export interface ThemeService {
  setTheme(theme: ThemeMode): Promise<void>
  getCurrentWindow(): { setTheme: (theme: ThemeMode) => Promise<void> }
}
