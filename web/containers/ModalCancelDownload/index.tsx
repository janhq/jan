import { useMemo } from 'react'

import { PluginType } from '@janhq/core'
import { ModelPlugin } from '@janhq/core/lib/plugins'
import { Model } from '@janhq/core/lib/types'

import {
  Modal,
  ModalTrigger,
  ModalClose,
  ModalFooter,
  ModalContent,
  ModalHeader,
  Button,
  ModalTitle,
} from '@janhq/uikit'

import { atom, useAtomValue } from 'jotai'

import { useDownloadState } from '@/hooks/useDownloadState'

import { formatDownloadPercentage } from '@/utils/converter'

import { downloadingModelsAtom } from '@/helpers/atoms/Model.atom'
import { pluginManager } from '@/plugin'

type Props = {
  suitableModel: Model
  isFromList?: boolean
}

export default function ModalCancelDownload({
  suitableModel,
  isFromList,
}: Props) {
  const { modelDownloadStateAtom } = useDownloadState()
  const downloadAtom = useMemo(
    () => atom((get) => get(modelDownloadStateAtom)[suitableModel.name]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [suitableModel.name]
  )
  const models = useAtomValue(downloadingModelsAtom)
  const downloadState = useAtomValue(downloadAtom)

  return (
    <Modal>
      <ModalTrigger asChild>
        {isFromList ? (
          <Button themes="outline" size="sm">
            Cancel ({formatDownloadPercentage(downloadState.percent)})
          </Button>
        ) : (
          <Button>
            Cancel ({formatDownloadPercentage(downloadState.percent)})
          </Button>
        )}
      </ModalTrigger>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Cancel Download</ModalTitle>
        </ModalHeader>
        <p>
          Are you sure you want to cancel the download of&nbsp;
          {downloadState?.fileName}?
        </p>
        <ModalFooter>
          <div className="flex gap-x-2">
            <ModalClose asChild>
              <Button themes="ghost">No</Button>
            </ModalClose>
            <ModalClose asChild>
              <Button
                themes="danger"
                onClick={() => {
                  if (downloadState?.fileName) {
                    const model = models.find(
                      (e) => e.id === downloadState?.fileName
                    )
                    if (!model) return
                    pluginManager
                      .get<ModelPlugin>(PluginType.Model)
                      ?.cancelModelDownload(downloadState.modelId)
                  }
                }}
              >
                Yes
              </Button>
            </ModalClose>
          </div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
