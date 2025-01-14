import { atom } from 'jotai'

export interface UserPreferences {
  username: string
  profileImage: string
}

const defaultPreferences: UserPreferences = {
  username: 'User',
  profileImage: ''
}

// Create the base atom
export const userPreferencesAtom = atom<UserPreferences>(defaultPreferences)

// Create a loading state atom
export const userPreferencesLoadingAtom = atom(false)

// Create an async read atom that loads from storage
export const userPreferencesReadAtom = atom(async (get) => {
  const prefs = get(userPreferencesAtom)
  
  if (typeof window === 'undefined') {
    return prefs
  }

  try {
    const storage = await window.core?.api?.getJanDataFolderPath()
    if (!storage) return prefs

    const prefsPath = await window.core?.api?.joinPath([storage, 'user-preferences.json'])
    if (!prefsPath) return prefs

    try {
      const savedPrefs = await window.core?.api?.readFile(prefsPath)
      if (savedPrefs) {
        return JSON.parse(savedPrefs)
      }
    } catch (error) {
      // If file doesn't exist yet, return default prefs
      return prefs
    }
  } catch (error) {
    console.error('Failed to load user preferences:', error)
    return prefs
  }
})

// Create a write atom that saves to storage
export const userPreferencesWriteAtom = atom(
  null,
  async (get, set, update: Partial<UserPreferences>) => {
    const currentPrefs = get(userPreferencesAtom)
    const newPrefs = { ...currentPrefs, ...update }
    
    set(userPreferencesAtom, newPrefs)

    if (typeof window === 'undefined') return

    try {
      const storage = await window.core?.api?.getJanDataFolderPath()
      if (!storage) return

      const prefsPath = await window.core?.api?.joinPath([storage, 'user-preferences.json'])
      if (!prefsPath) return

      await window.core?.api?.writeFile(prefsPath, JSON.stringify(newPrefs, null, 2))
    } catch (error) {
      console.error('Failed to save user preferences:', error)
    }
  }
)
