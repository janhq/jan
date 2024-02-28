import { useState } from 'react'

import { InferenceEngine, Model } from '@janhq/core'
import {
  Badge,
  Tooltip,
  TooltipArrow,
  TooltipContent,
  TooltipPortal,
  TooltipTrigger,
} from '@janhq/uikit'

import { useAtom } from 'jotai'
import {
  MoreVerticalIcon,
  Trash2Icon,
  PlayIcon,
  StopCircleIcon,
} from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import { useActiveModel } from '@/hooks/useActiveModel'
import { useClickOutside } from '@/hooks/useClickOutside'

import useDeleteModel from '@/hooks/useDeleteModel'

import { toGibibytes } from '@/utils/converter'

import { serverEnabledAtom } from '@/helpers/atoms/LocalServer.atom'

type RowModelProps = {
  data: Model
}

export default function RowModel(props: RowModelProps) {
  const [more, setMore] = useState(false)

  const [menu, setMenu] = useState<HTMLDivElement | null>(null)
  const [toggle, setToggle] = useState<HTMLDivElement | null>(null)
  useClickOutside(() => setMore(false), null, [menu, toggle])

  const { activeModel, startModel, stopModel, stateModel } = useActiveModel()
  const { deleteModel } = useDeleteModel()

  const isActiveModel = stateModel.model === props.data.id

  const [serverEnabled, setServerEnabled] = useAtom(serverEnabledAtom)

  const isRemoteModel =
    props.data.engine === InferenceEngine.openai ||
    props.data.engine === InferenceEngine.triton_trtllm

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
    <tr className="relative border-b border-border last:border-none">
      <td className="px-6 py-4 font-bold">{props.data.name}</td>
      <td className="px-6 py-4 font-bold">{props.data.id}</td>
      <td className="px-6 py-4">
        <Badge themes="secondary">
          {props.data.metadata.size
            ? toGibibytes(props.data.metadata.size)
            : '-'}
        </Badge>
      </td>
      <td className="px-6 py-4">
        <Badge themes="secondary">v{props.data.version}</Badge>
      </td>
      <td className="px-6 py-4">
        {isRemoteModel ? (
          <Badge
            themes="success"
            className="inline-flex items-center space-x-2"
          >
            <span className="h-2 w-2 rounded-full bg-green-500" />
            <span>Active</span>
          </Badge>
        ) : stateModel.loading && stateModel.model === props.data.id ? (
          <Badge
            className="inline-flex items-center space-x-2"
            themes="secondary"
          >
            <span className="h-2 w-2 rounded-full bg-gray-500" />
            <span className="capitalize">
              {stateModel.state === 'start' ? 'Starting...' : 'Stopping...'}
            </span>
          </Badge>
        ) : activeModel && activeModel.id === props.data.id ? (
          <Badge
            themes="success"
            className="inline-flex items-center space-x-2"
          >
            <span className="h-2 w-2 rounded-full bg-green-500" />
            <span>Active</span>
          </Badge>
        ) : (
          <Badge
            themes="secondary"
            className="inline-flex items-center space-x-2"
          >
            <span className="h-2 w-2 rounded-full bg-gray-500" />
            <span>Inactive</span>
          </Badge>
        )}
      </td>
      <td className="px-6 py-4 text-center">
        {!isRemoteModel && (
          <div
            className="cursor-pointer"
            ref={setToggle}
            onClick={() => {
              setMore(!more)
            }}
          >
            <MoreVerticalIcon className="h-5 w-5" />
          </div>
        )}
        {more && (
          <div
            className="absolute right-4 top-10 z-20 w-52 overflow-hidden rounded-lg border border-border bg-background py-2 shadow-lg"
            ref={setMenu}
          >
            <Tooltip>
              <TooltipTrigger className="w-full">
                <div
                  className={twMerge(
                    'flex items-center space-x-2 px-4 py-2 hover:bg-secondary',
                    serverEnabled &&
                      activeModel &&
                      activeModel.id !== props.data.id &&
                      'pointer-events-none cursor-not-allowed opacity-40'
                  )}
                  onClick={() => {
                    onModelActionClick(props.data.id)
                    setMore(false)
                  }}
                >
                  {activeModel && activeModel.id === props.data.id ? (
                    <StopCircleIcon
                      size={16}
                      className="text-muted-foreground"
                    />
                  ) : (
                    <PlayIcon size={16} className="text-muted-foreground" />
                  )}
                  <span className="text-bold capitalize text-black">
                    {isActiveModel ? stateModel.state : 'Start'}
                    &nbsp;Model
                  </span>
                </div>
              </TooltipTrigger>
              {serverEnabled && (
                <TooltipPortal>
                  <TooltipContent side="top">
                    <span>
                      {activeModel && activeModel.id === props.data.id
                        ? 'The API server is running, change model will stop the server'
                        : 'Threads are disabled while the server is running'}
                    </span>
                    <TooltipArrow />
                  </TooltipContent>
                </TooltipPortal>
              )}
            </Tooltip>

            <div
              className={twMerge(
                'flex cursor-pointer items-center space-x-2 px-4 py-2 hover:bg-secondary',
                serverEnabled &&
                  'pointer-events-none cursor-not-allowed opacity-40'
              )}
              onClick={() => {
                setTimeout(async () => {
                  if (!serverEnabled) {
                    await stopModel()
                    deleteModel(props.data)
                  }
                }, 500)
                setMore(false)
              }}
            >
              <Trash2Icon size={16} className="text-muted-foreground" />
              <span className="text-bold text-black">Delete Model</span>
            </div>
          </div>
        )}
      </td>
    </tr>
  )
}
