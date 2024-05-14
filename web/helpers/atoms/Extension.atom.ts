import { atom } from 'jotai'

type ExtensionId = string

export type InstallingExtensionState = {
  extensionId: ExtensionId
  percentage: number
  localPath?: string
}

export const installingExtensionAtom = atom<InstallingExtensionState[]>([])

export const setInstallingExtensionAtom = atom(
  null,
  (get, set, extensionId: string, state: InstallingExtensionState) => {
    const current = get(installingExtensionAtom)

    const isExists = current.some((e) => e.extensionId === extensionId)
    if (isExists) {
      const newCurrent = current.map((e) => {
        if (e.extensionId === extensionId) {
          return state
        }
        return e
      })
      set(installingExtensionAtom, newCurrent)
    } else {
      set(installingExtensionAtom, [...current, state])
    }
  }
)

export const removeInstallingExtensionAtom = atom(
  null,
  (get, set, extensionId: string) => {
    const current = get(installingExtensionAtom)
    const newCurrent = current.filter((e) => e.extensionId !== extensionId)
    set(installingExtensionAtom, newCurrent)
  }
)

export const inActiveEngineProviderAtom = atom<string[]>([])
