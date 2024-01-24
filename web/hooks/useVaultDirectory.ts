import { useEffect } from 'react'

import { fs, AppConfiguration } from '@janhq/core'

import { atom, useAtom } from 'jotai'

import { useMainViewState } from './useMainViewState'

const isSameDirectoryAtom = atom(false)
const isDirectoryConfirmAtom = atom(false)
const isErrorSetNewDestAtom = atom(false)
const currentPathAtom = atom('')
const newDestinationPathAtom = atom('')

export const SUCCESS_SET_NEW_DESTINATION = 'successSetNewDestination'

export function useVaultDirectory() {
  const [isSameDirectory, setIsSameDirectory] = useAtom(isSameDirectoryAtom)
  const { setMainViewState } = useMainViewState()
  const [isDirectoryConfirm, setIsDirectoryConfirm] = useAtom(
    isDirectoryConfirmAtom
  )
  const [isErrorSetNewDest, setIsErrorSetNewDest] = useAtom(
    isErrorSetNewDestAtom
  )
  const [currentPath, setCurrentPath] = useAtom(currentPathAtom)
  const [newDestinationPath, setNewDestinationPath] = useAtom(
    newDestinationPathAtom
  )

  useEffect(() => {
    window.core?.api
      ?.getAppConfigurations()
      ?.then((appConfig: AppConfiguration) => {
        setCurrentPath(appConfig.data_folder)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setNewDestination = async () => {
    const destFolder = await window.core?.api?.selectDirectory()
    setNewDestinationPath(destFolder)

    if (destFolder) {
      console.debug(`Destination folder selected: ${destFolder}`)
      try {
        const appConfiguration: AppConfiguration =
          await window.core?.api?.getAppConfigurations()
        const currentJanDataFolder = appConfiguration.data_folder

        if (currentJanDataFolder === destFolder) {
          console.debug(
            `Destination folder is the same as current folder. Ignore..`
          )
          setIsSameDirectory(true)
          setIsDirectoryConfirm(false)
          return
        } else {
          setIsSameDirectory(false)
          setIsDirectoryConfirm(true)
        }
        setIsErrorSetNewDest(false)
      } catch (e) {
        console.error(`Error: ${e}`)
        setIsErrorSetNewDest(true)
      }
    }
  }

  const applyNewDestination = async () => {
    try {
      const appConfiguration: AppConfiguration =
        await window.core?.api?.getAppConfigurations()
      const currentJanDataFolder = appConfiguration.data_folder

      appConfiguration.data_folder = newDestinationPath

      await fs.syncFile(currentJanDataFolder, newDestinationPath)
      await window.core?.api?.updateAppConfiguration(appConfiguration)
      console.debug(
        `File sync finished from ${currentPath} to ${newDestinationPath}`
      )

      setIsErrorSetNewDest(false)
      localStorage.setItem(SUCCESS_SET_NEW_DESTINATION, 'true')
      await window.core?.api?.relaunch()
    } catch (e) {
      console.error(`Error: ${e}`)
      setIsErrorSetNewDest(true)
    }
  }

  return {
    setNewDestination,
    newDestinationPath,
    applyNewDestination,
    isSameDirectory,
    setIsDirectoryConfirm,
    isDirectoryConfirm,
    setIsSameDirectory,
    currentPath,
    isErrorSetNewDest,
    setIsErrorSetNewDest,
  }
}
