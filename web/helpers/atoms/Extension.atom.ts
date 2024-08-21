import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

type ExtensionId = string

export type InstallingExtensionState = {
  extensionId: ExtensionId
  percentage: number
  localPath?: string
}

export type InstallingExtensionPackage = {
  extensionId: ExtensionId
  packageName: string
  percentage: number
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

export const installingPackageAtom = atom<InstallingExtensionPackage[]>([])

export const setInstallingPackageAtom = atom(
  null,
  (get, set, extensionId: string, state: InstallingExtensionPackage) => {
    const current = get(installingPackageAtom)

    const isExists = current.some(
      (e) =>
        e.extensionId === extensionId && e.packageName === state.packageName
    )
    if (isExists) {
      const newCurrent = current.map((e) => {
        if (
          e.extensionId === extensionId &&
          e.packageName === state.packageName
        ) {
          return state
        }
        return e
      })
      set(installingPackageAtom, newCurrent)
    } else {
      set(installingPackageAtom, [...current, state])
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

export const removeInstallingPackageAtom = atom(
  null,
  (get, set, extensionId: string, packageName: string) => {
    const current = get(installingPackageAtom)
    const newCurrent = current.filter(
      (e) => e.extensionId !== extensionId && e.packageName !== packageName
    )
    set(installingPackageAtom, newCurrent)
  }
)

const INACTIVE_ENGINE_PROVIDER = 'inActiveEngineProvider'
export const inActiveEngineProviderAtom = atomWithStorage<string[]>(
  INACTIVE_ENGINE_PROVIDER,
  []
)
