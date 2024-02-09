import { Fragment } from 'react'

import { InferenceEngine } from '@janhq/core'
import {
  CommandModal,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Badge,
} from '@janhq/uikit'

import { useAtom, useAtomValue } from 'jotai'
import { DatabaseIcon, CpuIcon } from 'lucide-react'

import { showSelectModelModalAtom } from '@/containers/Providers/KeyListener'

import { MainViewState } from '@/constants/screens'

import { useActiveModel } from '@/hooks/useActiveModel'
import { useMainViewState } from '@/hooks/useMainViewState'

import { serverEnabledAtom } from '@/helpers/atoms/LocalServer.atom'
import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'

export default function CommandListDownloadedModel() {
  const { setMainViewState } = useMainViewState()
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const { activeModel, startModel, stopModel } = useActiveModel()
  const [serverEnabled] = useAtom(serverEnabledAtom)
  const [showSelectModelModal, setShowSelectModelModal] = useAtom(
    showSelectModelModalAtom
  )

  const onModelActionClick = (modelId: string) => {
    if (activeModel && activeModel.id === modelId) {
      stopModel()
    } else {
      startModel(modelId)
    }
  }

  const isNotDownloadedModel = downloadedModels.length === 0
  if (isNotDownloadedModel || serverEnabled) return null

  return (
    <Fragment>
      <CommandModal
        open={showSelectModelModal}
        onOpenChange={setShowSelectModelModal}
      >
        <CommandInput placeholder="Search your model..." />
        <CommandList>
          <CommandEmpty>No Model found.</CommandEmpty>
          {!isNotDownloadedModel && (
            <CommandGroup heading="Your Model">
              {downloadedModels
                .filter((model) => model.engine === InferenceEngine.nitro)
                .map((model) => (
                  <CommandItem
                    key={model.id}
                    value={model.id}
                    onSelect={() => {
                      onModelActionClick(model.id)
                      setShowSelectModelModal(false)
                    }}
                  >
                    <DatabaseIcon
                      size={16}
                      className="mr-3 text-muted-foreground"
                    />
                    <div className="flex w-full items-center justify-between">
                      <span>{model.id}</span>
                      {activeModel && activeModel.id === model.id && (
                        <Badge themes="secondary">Active</Badge>
                      )}
                    </div>
                  </CommandItem>
                ))}
            </CommandGroup>
          )}
          <CommandGroup heading="Find another model">
            <CommandItem
              onSelect={() => {
                setMainViewState(MainViewState.Hub)
                setShowSelectModelModal(false)
              }}
            >
              <CpuIcon size={16} className="mr-3 text-muted-foreground" />
              <span>Explore The Hub</span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandModal>
    </Fragment>
  )
}
