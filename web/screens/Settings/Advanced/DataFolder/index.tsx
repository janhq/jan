import { Fragment, useCallback, useState } from 'react'

import { fs, AppConfiguration, isSubdirectory } from '@janhq/core'
import { Button, Input } from '@janhq/uikit'
import { useAtomValue, useSetAtom } from 'jotai'
import { PencilIcon, FolderOpenIcon } from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import Loader from '@/containers/Loader'

export const SUCCESS_SET_NEW_DESTINATION = 'successSetNewDestination'

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

import { appConfigurationAtom } from '@/helpers/atoms/AppConfig.atom'

type Props = {
  onBoarding?: boolean
}

const DataFolder = ({ onBoarding = false }: Props) => {
  const [showLoader, setShowLoader] = useState(false)
  const [tmpDirVal, setTmpDirVal] = useState('')
  const setShowDirectoryConfirm = useSetAtom(showDirectoryConfirmModalAtom)
  const setShowSameDirectory = useSetAtom(showSamePathModalAtom)
  const setShowChangeFolderError = useSetAtom(showChangeFolderErrorAtom)
  const showDestNotEmptyConfirm = useSetAtom(showDestNotEmptyConfirmAtom)

  const [destinationPath, setDestinationPath] = useState(undefined)
  const appConfig = useAtomValue(appConfigurationAtom)

  const onChangeFolderClick = useCallback(async () => {
    const destFolder = await window.core?.api?.selectDirectory()
    if (!destFolder) return

    if (destFolder === appConfig?.data_folder ?? '') {
      setShowSameDirectory(true)
      return
    }

    setTmpDirVal(destFolder)

    const appConfiguration: AppConfiguration =
      await window.core?.api?.getAppConfigurations()
    const currentJanDataFolder = appConfiguration.data_folder

    if (await isSubdirectory(currentJanDataFolder, destFolder)) {
      setShowSameDirectory(true)
      return
    }

    const newDestChildren: string[] = await fs.readdirSync(destFolder)
    const isNotEmpty =
      newDestChildren.filter((x) => x !== '.DS_Store').length > 0

    if (isNotEmpty) {
      showDestNotEmptyConfirm(true)
      return
    }

    setDestinationPath(destFolder)
    setShowDirectoryConfirm(true)
  }, [
    appConfig,
    setShowDirectoryConfirm,
    setShowSameDirectory,
    showDestNotEmptyConfirm,
  ])

  const onUserConfirmed = useCallback(async () => {
    if (!destinationPath) return
    try {
      setShowLoader(true)
      const appConfiguration: AppConfiguration =
        await window.core?.api?.getAppConfigurations()
      const currentJanDataFolder = appConfiguration.data_folder
      appConfiguration.data_folder = destinationPath
      const { err } = await fs.syncFile(currentJanDataFolder, destinationPath)
      if (err) throw err
      await window.core?.api?.updateAppConfiguration(appConfiguration)
      console.debug(
        `File sync finished from ${currentJanDataFolder} to ${destinationPath}`
      )
      localStorage.setItem(SUCCESS_SET_NEW_DESTINATION, 'true')
      setTimeout(() => {
        setShowLoader(false)
      }, 1200)
      !onBoarding && (await window.core?.api?.relaunch())
    } catch (e) {
      console.error(e)
      setShowLoader(false)
      setShowChangeFolderError(true)
    }
  }, [destinationPath, onBoarding, setShowChangeFolderError])

  return (
    <Fragment>
      <div className="flex w-full items-center gap-x-3">
        <div className="relative w-full">
          <Input
            value={tmpDirVal || (appConfig?.data_folder ?? '')}
            className={twMerge(onBoarding ? 'w-full' : 'w-[240px] pr-8')}
            disabled
          />
          {!onBoarding && (
            <FolderOpenIcon
              size={16}
              className="absolute right-2 top-1/2 z-10 -translate-y-1/2 cursor-pointer"
              onClick={() => window.core?.api?.openAppDirectory()}
            />
          )}
        </div>
        <Button
          size="sm"
          themes={onBoarding ? 'primary' : 'outline'}
          className="h-9 w-9 flex-shrink-0 p-0"
          onClick={onChangeFolderClick}
        >
          <PencilIcon size={16} />
        </Button>
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
