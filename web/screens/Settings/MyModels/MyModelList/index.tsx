import { memo, useState } from 'react'

import { InferenceEngine, Model } from '@janhq/core'
import { Badge, Tooltip, useClickOutside } from '@janhq/joi'
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

import { serverEnabledAtom } from '@/helpers/atoms/LocalServer.atom'

type Props = {
  model: Model
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
    <div className="border border-b-0 border-[hsla(var(--app-border))] bg-[hsla(var(--app-secondary-bg))] p-4 first:rounded-t-lg last:rounded-b-lg last:border-b">
      <div className="flex flex-col items-start justify-start gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h6
          className={twMerge(
            'line-clamp-1 font-medium',
            model.engine !== InferenceEngine.nitro &&
              'text-[hsla(var(--text-secondary))]'
          )}
        >
          {model.name}
        </h6>

        {model.engine === InferenceEngine.nitro && (
          <>
            <p className="line-clamp-1 text-[hsla(var(--text-secondary))]">
              {model.id}
            </p>
            <Badge theme="secondary">{toGibibytes(model.metadata.size)}</Badge>

            <div className="flex items-center gap-x-4">
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
                className="cursor-pointer"
                ref={setToggle}
                onClick={() => {
                  setMore(!more)
                }}
              >
                <MoreVerticalIcon className="h-5 w-5" />
                {more && (
                  <div
                    className="absolute right-4 top-10 z-20 w-52 overflow-hidden rounded-lg border border-[hsla(var(--app-border))] bg-[hsla(var(--app-bg))] py-2 shadow-lg"
                    ref={setMenu}
                  >
                    <Tooltip
                      trigger={
                        <div
                          className={twMerge(
                            'hover:bg-secondary flex items-center space-x-2 px-4 py-2',
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
                        'flex cursor-pointer items-center space-x-2 px-4 py-2',
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
          </>
        )}
      </div>
    </div>
  )
}

export default memo(MyModelList)
