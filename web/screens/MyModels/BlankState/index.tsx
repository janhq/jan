import { Button } from '@janhq/uikit'
import {
  Modal,
  ModalTrigger,
  ModalContent,
  ModalHeader,
  ModalTitle,
  Progress,
} from '@janhq/uikit'
import { LayoutGridIcon } from 'lucide-react'

import { MainViewState } from '@/constants/screens'

import { useDownloadState } from '@/hooks/useDownloadState'
import { useMainViewState } from '@/hooks/useMainViewState'

import { formatDownloadPercentage } from '@/utils/converter'

export default function BlankStateMyModel() {
  const { setMainViewState } = useMainViewState()
  const { downloadStates } = useDownloadState()

  return (
    <div className="flex h-full items-center justify-center px-4">
      <div className="text-center">
        <LayoutGridIcon size={32} className="mx-auto text-primary/80" />
        <div className="mt-4">
          <h1 className="text-xl font-bold leading-snug">{`Ups, You don't have a model.`}</h1>
          <p className="mt-1 text-base">
            {downloadStates.length
              ? `Downloading model ... `
              : `let’s download your first model`}
          </p>
          {downloadStates?.length && (
            <Modal>
              <ModalTrigger asChild>
                <Button themes="outline" className="mr-2 mt-6">
                  <span>{downloadStates.length} Downloading model</span>
                </Button>
              </ModalTrigger>
              <ModalContent>
                <ModalHeader>
                  <ModalTitle>Downloading model</ModalTitle>
                </ModalHeader>

                {downloadStates.map((item, i) => {
                  return (
                    <div className="pt-2" key={i}>
                      <Progress
                        className="mb-2 h-2"
                        value={
                          formatDownloadPercentage(item?.percent, {
                            hidePercentage: true,
                          }) as number
                        }
                      />
                      <div className="flex items-center justify-between">
                        <p>{item?.fileName}</p>
                        <span>{formatDownloadPercentage(item?.percent)}</span>
                      </div>
                    </div>
                  )
                })}
              </ModalContent>
            </Modal>
          )}
          <Button
            className="mt-6"
            onClick={() => setMainViewState(MainViewState.ExploreModels)}
          >
            Explore Models
          </Button>
        </div>
      </div>
    </div>
  )
}
