import { memo, useState } from 'react'

import { InferenceEngine, ModelFile } from '@janhq/core'
import { Badge, Button, Tooltip, useClickOutside } from '@janhq/joi'
import { useAtom } from 'jotai'
import {
  MoreVerticalIcon,
  PlayIcon,
  StopCircleIcon,
  Trash2Icon,
} from 'lucide-react'
import { twMerge } from 'tailwind-merge'

import { useActiveModel } from '@/hooks/useActiveModel'
import useDeleteModel from '@/hooks/useDeleteModel'

import { toGibibytes } from '@/utils/converter'

import { localEngines } from '@/utils/modelEngine'

import { serverEnabledAtom } from '@/helpers/atoms/LocalServer.atom'

type Props = {
  model: ModelFile
  groupTitle?: string
}

const MyModelList = ({ model }: Props) => {
  const { activeModel, startModel, stopModel, stateModel } = useActiveModel()
  const isActiveModel = stateModel.model?.id === model.id
  const { deleteModel } = useDeleteModel()
  const [more, setMore] = useState(false)
  const [serverEnabled, setServerEnabled] = useAtom(serverEnabledAtom)

  const [menu, setMenu] = useState<HTMLDivElement | null>(null)
  const [toggle, setToggle] = useState<HTMLDivElement | null>(null)
  useClickOutside(() => setMore(false), null, [menu, toggle])

  const onModelActionClick = (modelId: string) => {
    if (activeModel && activeModel.id === modelId) {
      stopModel()
      window.core?.api?.stopServer()
      setServerEnabled(false)
    } else if (!serverEnabled) {
      startModel(modelId)
    }
  }

  return (
    <div className="border border-b-0 border-[hsla(var(--app-border))] bg-[hsla(var(--tertiary-bg))] p-4 first:rounded-t-lg last:rounded-b-lg last:border-b">
      <div className="flex flex-col items-start justify-start gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex w-1/2 gap-x-8">
          <div className="flex w-full items-center justify-between">
            <h6
              className={twMerge(
                'line-clamp-1 max-w-[200px] font-medium',
                model.engine !== InferenceEngine.nitro &&
                  'max-w-none text-[hsla(var(--text-secondary))]'
              )}
              title={model.name}
            >
              {model.name}
            </h6>
            {model.engine === InferenceEngine.nitro && (
              <div className="flex gap-x-8">
                <p
                  className="line-clamp-1 max-w-[120px] text-[hsla(var(--text-secondary))] xl:max-w-none"
                  title={model.id}
                >
                  {model.id}
                </p>
              </div>
            )}
          </div>
        </div>

        {localEngines.includes(model.engine) && (
          <div className="flex gap-x-4">
            <Badge theme="secondary" className="sm:mr-16">
              {toGibibytes(model.metadata.size)}
            </Badge>

            <div className="relative flex items-center gap-x-4">
              {stateModel.loading && stateModel.model?.id === model.id ? (
                <Badge
                  className="inline-flex items-center space-x-2"
                  theme="secondary"
                >
                  <span className="h-2 w-2 rounded-full bg-gray-500" />
                  <span className="capitalize">
                    {stateModel.state === 'start'
                      ? 'Starting...'
                      : 'Stopping...'}
                  </span>
                </Badge>
              ) : activeModel && activeModel.id === model.id ? (
                <Badge
                  theme="success"
                  variant="soft"
                  className="inline-flex items-center space-x-2"
                >
                  <span className="h-2 w-2 rounded-full bg-green-500" />
                  <span>Active</span>
                </Badge>
              ) : (
                <Badge
                  theme="secondary"
                  className="inline-flex items-center space-x-2"
                >
                  <span className="h-2 w-2 rounded-full bg-gray-500" />
                  <span>Inactive</span>
                </Badge>
              )}
              <div
                className="inline-flex cursor-pointer"
                ref={setToggle}
                onClick={() => {
                  setMore(!more)
                }}
              >
                <Button theme="icon">
                  <MoreVerticalIcon />
                </Button>
                {more && (
                  <div
                    className="absolute right-8 top-0 z-20 w-52 overflow-hidden rounded-lg border border-[hsla(var(--app-border))] bg-[hsla(var(--app-bg))] shadow-lg"
                    ref={setMenu}
                  >
                    <Tooltip
                      trigger={
                        <div
                          className={twMerge(
                            'flex items-center space-x-2 px-4 py-2 hover:bg-[hsla(var(--dropdown-menu-hover-bg))]',
                            serverEnabled &&
                              activeModel &&
                              activeModel.id !== model.id &&
                              'pointer-events-none cursor-not-allowed opacity-40'
                          )}
                          onClick={() => {
                            onModelActionClick(model.id)
                            setMore(false)
                          }}
                        >
                          {activeModel && activeModel.id === model.id ? (
                            <StopCircleIcon
                              size={16}
                              className="text-[hsla(var(--text-secondary))]"
                            />
                          ) : (
                            <PlayIcon
                              size={16}
                              className="text-[hsla(var(--text-secondary))]"
                            />
                          )}
                          <span className="text-bold capitalize">
                            {isActiveModel ? stateModel.state : 'Start'}
                            &nbsp;Model
                          </span>
                        </div>
                      }
                      disabled={!serverEnabled}
                      content={
                        <span>
                          {activeModel && activeModel.id === model.id
                            ? 'The API server is running, change model will stop the server'
                            : 'Threads are disabled while the server is running'}
                        </span>
                      }
                    />
                    <div
                      className={twMerge(
                        'flex cursor-pointer items-center space-x-2 px-4 py-2 hover:bg-[hsla(var(--dropdown-menu-hover-bg))]',
                        serverEnabled &&
                          'pointer-events-none cursor-not-allowed opacity-40'
                      )}
                      onClick={() => {
                        setTimeout(async () => {
                          if (!serverEnabled) {
                            await stopModel()
                            deleteModel(model)
                          }
                        }, 500)
                        setMore(false)
                      }}
                    >
                      <Trash2Icon
                        size={16}
                        className="text-[hsla(var(--destructive-bg))]"
                      />
                      <span className="text-bold text-[hsla(var(--destructive-bg))]">
                        Delete Model
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(MyModelList)
