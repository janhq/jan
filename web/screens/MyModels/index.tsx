import { Fragment } from 'react'

import {
  Badge,
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Modal,
  ModalTrigger,
  ScrollArea,
  ModalClose,
  ModalFooter,
  ModalContent,
  ModalHeader,
  ModalTitle,
} from '@janhq/uikit'

import { MainViewState } from '@/constants/screens'

import { useActiveModel } from '@/hooks/useActiveModel'
import useDeleteModel from '@/hooks/useDeleteModel'
import { useDownloadState } from '@/hooks/useDownloadState'
import { useGetDownloadedModels } from '@/hooks/useGetDownloadedModels'

import { useMainViewState } from '@/hooks/useMainViewState'

import BlankStateMyModel from '@/screens/MyModels/BlankState'

import { toGigabytes } from '@/utils/converter'

const MyModelsScreen = () => {
  const { downloadedModels } = useGetDownloadedModels()
  const { downloadStates } = useDownloadState()
  const { setMainViewState } = useMainViewState()
  const { deleteModel } = useDeleteModel()

  const { activeModel, startModel, stopModel, stateModel } = useActiveModel()

  if (downloadedModels.length === 0) return <BlankStateMyModel />

  const onModelActionClick = (modelId: string) => {
    if (activeModel && activeModel.id === modelId) {
      stopModel(modelId)
    } else {
      startModel(modelId)
    }
  }

  return (
    <div className="flex h-full w-full bg-background">
      <ScrollArea className="h-full w-full">
        <div className="p-4" data-test-id="testid-my-models">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            {downloadedModels.map((model, i) => {
              const isActiveModel = stateModel.model === model.id
              return (
                <div
                  key={i}
                  className="rounded-lg border border-border bg-background p-4"
                >
                  <Fragment>
                    <div className="flex items-start gap-x-4">
                      <div className="inline-flex rounded-full border border-border p-1">
                        <Avatar className="h-8 w-8">
                          <AvatarImage alt={model.metadata.author} />
                          <AvatarFallback>
                            {model.metadata.author.charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                      </div>
                      <div>
                        <h2 className="mb-1 font-medium capitalize">
                          {model.metadata.author}
                        </h2>
                        <p className="line-clamp-1">{model.name}</p>
                        <div className="mt-2 flex items-center gap-2">
                          <Badge themes="secondary">v{model.version}</Badge>
                          <Badge themes="outline">GGUF</Badge>
                          <Badge themes="outline">
                            {toGigabytes(model.metadata.size)}
                          </Badge>
                        </div>
                        <p className="mt-2 line-clamp-2 break-all">
                          {model.description}
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 flex items-center justify-center gap-x-2 gap-y-4 border-t border-border pt-4">
                      <Modal>
                        <ModalTrigger asChild>
                          <Button themes="ghost" block>
                            Delete
                          </Button>
                        </ModalTrigger>
                        <ModalContent>
                          <ModalHeader>
                            <ModalTitle>Are you sure?</ModalTitle>
                          </ModalHeader>
                          <p className="leading-relaxed">
                            Delete model {model.name}, v{model.version},{' '}
                            {toGigabytes(model.metadata.size)}.
                          </p>
                          <ModalFooter>
                            <div className="flex gap-x-2">
                              <ModalClose asChild>
                                <Button themes="ghost">No</Button>
                              </ModalClose>
                              <ModalClose asChild>
                                <Button
                                  themes="danger"
                                  onClick={() =>
                                    setTimeout(async () => {
                                      await stopModel(model.id)
                                      deleteModel(model)
                                    }, 500)
                                  }
                                >
                                  Yes
                                </Button>
                              </ModalClose>
                            </div>
                          </ModalFooter>
                        </ModalContent>
                      </Modal>
                      <Button
                        block
                        themes={
                          isActiveModel && stateModel.state === 'stop'
                            ? 'danger'
                            : 'primary'
                        }
                        className="capitalize"
                        loading={isActiveModel ? stateModel.loading : false}
                        onClick={() => onModelActionClick(model.id)}
                      >
                        {isActiveModel ? stateModel.state : 'Start'}
                        &nbsp;Model
                      </Button>
                    </div>
                  </Fragment>
                </div>
              )
            })}

            <div className="rounded-lg border border-border bg-background p-4 hover:border-primary/60">
              <div className="flex h-full flex-col justify-between">
                <div>
                  <h2 className="text-lg font-medium">Download more models?</h2>
                  <p className="mt-2 leading-relaxed">
                    You have <span>{downloadedModels.length}</span> model(s)
                    downloaded.&nbsp;
                    {downloadStates.length > 0 && (
                      <span>
                        And {downloadStates.length} downloading progress.
                      </span>
                    )}
                  </p>
                </div>
                <div className="mt-4 flex items-end justify-center gap-4 border-t border-border pt-4">
                  <Button
                    themes="secondary"
                    block
                    onClick={() => setMainViewState(MainViewState.Hub)}
                  >
                    Explore Models
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}

export default MyModelsScreen
