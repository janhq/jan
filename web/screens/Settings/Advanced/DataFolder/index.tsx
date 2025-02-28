import { Fragment, useCallback, useState } from 'react'

import { AppConfiguration, isSubdirectory } from '@janhq/core'
import { Button, Input } from '@janhq/joi'
import { useAtomValue, useSetAtom } from 'jotai'
import { PencilIcon, FolderOpenIcon } from 'lucide-react'

import Loader from '@/containers/Loader'

export const SUCCESS_SET_NEW_DESTINATION = 'successSetNewDestination'

import { useApp } from '@/hooks/useApp'

import ModalChangeDirectory, {
  showDirectoryConfirmModalAtom,
} from './ModalChangeDirectory'
import ModalChangeDestNotEmpty, {
  showDestNotEmptyConfirmAtom,
} from './ModalConfirmDestNotEmpty'
import ModalErrorSetDestGlobal, {
  showChangeFolderErrorAtom,
} from './ModalErrorSetDestGlobal'

import ModalSameDirectory, { showSamePathModalAtom } from './ModalSameDirectory'

import { janDataFolderPathAtom } from '@/helpers/atoms/AppConfig.atom'

const DataFolder = () => {
  const [showLoader, setShowLoader] = useState(false)
  const setShowDirectoryConfirm = useSetAtom(showDirectoryConfirmModalAtom)
  const setShowSameDirectory = useSetAtom(showSamePathModalAtom)
  const setShowChangeFolderError = useSetAtom(showChangeFolderErrorAtom)
  const showDestNotEmptyConfirm = useSetAtom(showDestNotEmptyConfirmAtom)

  const [destinationPath, setDestinationPath] = useState(undefined)
  const janDataFolderPath = useAtomValue(janDataFolderPathAtom)
  const { relaunch } = useApp()

  const onChangeFolderClick = useCallback(async () => {
    const destFolder = await window.core?.api?.selectDirectory()
    if (!destFolder) return

    if (destFolder === janDataFolderPath) {
      setShowSameDirectory(true)
      return
    }

    const appConfiguration: AppConfiguration =
      await window.core?.api?.getAppConfigurations()
    const currentJanDataFolder = appConfiguration.data_folder

    if (await isSubdirectory(currentJanDataFolder, destFolder)) {
      setShowSameDirectory(true)
      return
    }

    const isEmpty: boolean =
      await window.core?.api?.isDirectoryEmpty(destFolder)

    if (!isEmpty) {
      setDestinationPath(destFolder)
      showDestNotEmptyConfirm(true)
      return
    }

    setDestinationPath(destFolder)
    setShowDirectoryConfirm(true)
  }, [
    janDataFolderPath,
    setShowDirectoryConfirm,
    setShowSameDirectory,
    showDestNotEmptyConfirm,
  ])

  const onUserConfirmed = useCallback(async () => {
    if (!destinationPath) return
    try {
      setShowLoader(true)
      await window.core?.api?.changeDataFolder(destinationPath)
      localStorage.setItem(SUCCESS_SET_NEW_DESTINATION, 'true')
      setTimeout(() => {
        setShowLoader(false)
      }, 1200)
      await relaunch()
    } catch (e) {
      console.error(e)
      setShowLoader(false)
      setShowChangeFolderError(true)
    }
  }, [destinationPath, setShowChangeFolderError])

  return (
    <Fragment>
      <div className="flex w-full flex-col items-start justify-between gap-4 border-b border-[hsla(var(--app-border))] py-4 first:pt-0 last:border-none sm:flex-row">
        <div className="space-y-1">
          <div className="flex gap-x-2">
            <h6 className="font-semibold capitalize">Jan Data Folder</h6>
          </div>
          <p className="font-medium leading-relaxed text-[hsla(var(--text-secondary))]">
            Default location for messages and other user data.
          </p>
        </div>
        <div className="flex items-center gap-x-3">
          <div className="relative">
            <Input
              data-testid="jan-data-folder-input"
              value={janDataFolderPath}
              className="w-full pr-8 sm:w-[240px]"
              disabled
            />
            <FolderOpenIcon
              size={16}
              className="absolute right-2 top-1/2 z-10 -translate-y-1/2 cursor-pointer"
              onClick={() => window.core?.api?.openAppDirectory()}
            />
          </div>
          <Button
            size="small"
            theme="ghost"
            variant="outline"
            className="h-9 w-9 flex-shrink-0 p-0"
            onClick={onChangeFolderClick}
          >
            <PencilIcon size={16} />
          </Button>
        </div>
      </div>
      <ModalSameDirectory onChangeFolderClick={onChangeFolderClick} />
      <ModalChangeDirectory
        destinationPath={destinationPath ?? ''}
        onUserConfirmed={onUserConfirmed}
      />
      <ModalErrorSetDestGlobal />
      <ModalChangeDestNotEmpty onUserConfirmed={onUserConfirmed} />
      {showLoader && <Loader description="Relocating Jan Data Folder..." />}
    </Fragment>
  )
}

export default DataFolder
