import { Fragment, useCallback, useEffect, useState } from 'react'

import { fs, AppConfiguration } from '@janhq/core'
import { Button, Input } from '@janhq/uikit'
import { useSetAtom } from 'jotai'
import { PencilIcon, FolderOpenIcon } from 'lucide-react'

import { SUCCESS_SET_NEW_DESTINATION } from '@/hooks/useVaultDirectory'

import ModalChangeDirectory, {
  showDirectoryConfirmModalAtom,
} from './ModalChangeDirectory'
import ModalErrorSetDestGlobal, {
  showChangeFolderErrorAtom,
} from './ModalErrorSetDestGlobal'
import ModalSameDirectory, { showSamePathModalAtom } from './ModalSameDirectory'

const DataFolder = () => {
  const [janDataFolderPath, setJanDataFolderPath] = useState('')
  const setShowDirectoryConfirm = useSetAtom(showDirectoryConfirmModalAtom)
  const setShowSameDirectory = useSetAtom(showSamePathModalAtom)
  const setShowChangeFolderError = useSetAtom(showChangeFolderErrorAtom)
  const [destinationPath, setDestinationPath] = useState(undefined)

  useEffect(() => {
    window.core?.api
      ?.getAppConfigurations()
      ?.then((appConfig: AppConfiguration) => {
        setJanDataFolderPath(appConfig.data_folder)
      })
  }, [])

  const onChangeFolderClick = useCallback(async () => {
    const destFolder = await window.core?.api?.selectDirectory()
    if (!destFolder) return

    if (destFolder === janDataFolderPath) {
      setShowSameDirectory(true)
      return
    }

    setDestinationPath(destFolder)
    setShowDirectoryConfirm(true)
  }, [janDataFolderPath, setShowSameDirectory, setShowDirectoryConfirm])

  const onUserConfirmed = useCallback(async () => {
    const destination = destinationPath
    if (!destination) return
    try {
      const appConfiguration: AppConfiguration =
        await window.core?.api?.getAppConfigurations()
      const currentJanDataFolder = appConfiguration.data_folder
      appConfiguration.data_folder = destination
      await fs.syncFile(currentJanDataFolder, destination)
      await window.core?.api?.updateAppConfiguration(appConfiguration)

      console.debug(
        `File sync finished from ${currentJanDataFolder} to ${destination}`
      )

      localStorage.setItem(SUCCESS_SET_NEW_DESTINATION, 'true')
      await window.core?.api?.relaunch()
    } catch (e) {
      console.error(`Error: ${e}`)
      setShowChangeFolderError(true)
    }
  }, [destinationPath, setShowChangeFolderError])

  return (
    <Fragment>
      <div className="flex w-full items-start justify-between border-b border-border py-4 first:pt-0 last:border-none">
        <div className="flex-shrink-0 space-y-1.5">
          <div className="flex gap-x-2">
            <h6 className="text-sm font-semibold capitalize">
              Jan Data Folder
            </h6>
          </div>
          <p className="leading-relaxed">
            Where messages, model configurations, and other user data are
            placed.
          </p>
        </div>
        <div className="flex items-center gap-x-3">
          <div className="relative">
            <Input
              value={janDataFolderPath}
              className="w-[240px] pr-8"
              disabled
            />
            <FolderOpenIcon
              size={16}
              className="absolute right-2 top-1/2 -translate-y-1/2"
            />
          </div>
          <Button
            size="sm"
            themes="outline"
            className="h-9 w-9 p-0"
            onClick={onChangeFolderClick}
          >
            <PencilIcon size={16} />
          </Button>
        </div>
      </div>
      <ModalSameDirectory />
      <ModalChangeDirectory
        destinationPath={destinationPath ?? ''}
        onUserConfirmed={onUserConfirmed}
      />
      <ModalErrorSetDestGlobal />
    </Fragment>
  )
}

export default DataFolder
