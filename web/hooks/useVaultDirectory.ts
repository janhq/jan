import { useEffect, useState } from 'react'

import { fs, AppConfiguration } from '@janhq/core'

export const SUCCESS_SET_NEW_DESTINATION = 'successSetNewDestination'

export function useVaultDirectory() {
  const [isSameDirectory, setIsSameDirectory] = useState(false)
  const [isDirectoryConfirm, setIsDirectoryConfirm] = useState(false)
  const [isErrorSetNewDest, setIsErrorSetNewDest] = useState(false)
  const [currentPath, setCurrentPath] = useState('')
  const [newDestinationPath, setNewDestinationPath] = useState('')

  useEffect(() => {
    window.core?.api
      ?.getAppConfigurations()
      ?.then((appConfig: AppConfiguration) => {
        setCurrentPath(appConfig.data_folder)
      })
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
