import { Button, Input } from '@janhq/uikit'
import { PencilIcon, FolderOpenIcon } from 'lucide-react'

import { useVaultDirectory } from '@/hooks/useVaultDirectory'

import ModalChangeDirectory from './ModalChangeDirectory'
import ModalErrorSetDestGlobal from './ModalErrorSetDestGlobal'
import ModalSameDirectory from './ModalSameDirectory'

const DataFolder = () => {
  const { currentPath, setNewDestination } = useVaultDirectory()

  return (
    <>
      <div className="flex w-full items-start justify-between border-b border-border py-4 first:pt-0 last:border-none">
        <div className="flex-shrink-0 space-y-1.5">
          <div className="flex gap-x-2">
            <h6 className="text-sm font-semibold capitalize">
              Jan Data Folder
            </h6>
          </div>
          <p className="leading-relaxed">
            Where messages, model configurations, and other user data is placed.
          </p>
        </div>
        <div className="flex items-center gap-x-3">
          <div className="relative">
            <Input value={currentPath} className="w-[240px] pr-8" disabled />
            <FolderOpenIcon
              size={16}
              className="absolute right-2 top-1/2 -translate-y-1/2"
            />
          </div>
          <Button
            size="sm"
            themes="outline"
            className="h-9 w-9 p-0"
            onClick={setNewDestination}
          >
            <PencilIcon size={16} />
          </Button>
        </div>
      </div>
      <ModalSameDirectory />
      <ModalChangeDirectory />
      <ModalErrorSetDestGlobal />
    </>
  )
}

export default DataFolder
