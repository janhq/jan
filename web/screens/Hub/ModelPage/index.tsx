import Image from 'next/image'

import { ModelSource } from '@janhq/core'
import { Badge, Button, ScrollArea } from '@janhq/joi'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  ArrowLeftIcon,
  DownloadIcon,
  FileJson,
  RefreshCwIcon,
  SettingsIcon,
} from 'lucide-react'

import Spinner from '@/containers/Loader/Spinner'
import ModelDownloadButton from '@/containers/ModelDownloadButton'

import ModelLabel from '@/containers/ModelLabel'

import { MainViewState } from '@/constants/screens'

import { useRefreshModelList } from '@/hooks/useEngineManagement'

import { MarkdownTextMessage } from '@/screens/Thread/ThreadCenterPanel/TextMessage/MarkdownTextMessage'

import { toGigabytes } from '@/utils/converter'
import { extractModelName, removeYamlFrontMatter } from '@/utils/modelSource'

import RemoteModelRefresh from './RemoteModelRefresh'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'
import {
  selectedSettingAtom,
  showScrollBarAtom,
} from '@/helpers/atoms/Setting.atom'

type Props = {
  model: ModelSource
  onGoBack: () => void
}

const ModelPage = ({ model, onGoBack }: Props) => {
  const setSelectedSetting = useSetAtom(selectedSettingAtom)
  const setMainViewState = useSetAtom(mainViewStateAtom)
  const showScrollBar = useAtomValue(showScrollBarAtom)

  return (
    <ScrollArea
      type={showScrollBar ? 'always' : 'scroll'}
      data-testid="hub-container-test-id"
      className="h-full w-full"
    >
      <div className="flex h-full w-full justify-center">
        <div className="flex w-full max-w-[800px] flex-col ">
          <div className="sticky top-0 flex h-12 items-center bg-[hsla(var(--app-bg))] px-4">
            <div className="flex items-center gap-2">
              <button
                onClick={onGoBack}
                className="flex items-center gap-1 text-sm text-[hsla(var(--text-secondary))] hover:text-[hsla(var(--text-primary))]"
              >
                <ArrowLeftIcon size={16} />
                <span>Back</span>
              </button>
            </div>
          </div>
          <div className="p-4">
            {/* Header */}
            <div className="flex items-center justify-between py-2">
              <span className="line-clamp-1 text-base font-medium capitalize group-hover:text-blue-500 group-hover:underline">
                {model.type !== 'cloud'
                  ? extractModelName(model.metadata.id)
                  : model.metadata.id}
              </span>
              <div className="inline-flex items-center space-x-2">
                {model.type === 'cloud' && (
                  <>
                    {!model.metadata?.apiKey?.length ? (
                      <Button
                        onClick={() => {
                          setSelectedSetting(model.id)
                          setMainViewState(MainViewState.Settings)
                        }}
                      >
                        Set Up
                      </Button>
                    ) : (
                      <Button
                        theme="ghost"
                        variant="outline"
                        className="w-8 p-0"
                        onClick={() => {
                          setSelectedSetting(model.id)
                          setMainViewState(MainViewState.Settings)
                        }}
                      >
                        <SettingsIcon
                          size={18}
                          className="text-[hsla(var(--text-secondary))]"
                        />
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
            <div className="mb-6 flex flex-row divide-x">
              {(model?.author ?? model?.metadata?.author) && (
                <p
                  className="font-regular mt-3 line-clamp-1 flex flex-row pr-4 capitalize text-[hsla(var(--text-secondary))]"
                  title={model?.author ?? model?.metadata?.author}
                >
                  {model.id?.includes('huggingface.co') && (
                    <>
                      <Image
                        src={'icons/huggingFace.svg'}
                        width={16}
                        height={16}
                        className="mr-2"
                        alt=""
                      />{' '}
                    </>
                  )}
                  {model?.author ?? model?.metadata?.author}
                </p>
              )}
              {model.models?.length > 0 && (
                <p className="font-regular mt-3 line-clamp-1 flex flex-row items-center pl-4 pr-4 text-[hsla(var(--text-secondary))] first:pl-0">
                  <FileJson size={16} className="mr-2" />
                  {model.models?.length}{' '}
                  {model.type === 'cloud' ? 'models' : 'versions'}
                </p>
              )}
              {model.metadata?.downloads > 0 && (
                <p className="font-regular mt-3 line-clamp-1 flex flex-row items-center px-4 text-[hsla(var(--text-secondary))]">
                  <DownloadIcon size={16} className="mr-2" />
                  {model.metadata?.downloads}
                </p>
              )}
            </div>
            {/* Table of versions */}
            <div className="mt-8 flex w-full flex-col items-start justify-between sm:flex-row">
              <div className="w-full flex-shrink-0 rounded-lg border border-[hsla(var(--app-border))] text-[hsla(var(--text-secondary))]">
                <table className="w-full p-4">
                  <thead className="bg-[hsla(var(--tertiary-bg))]">
                    <tr>
                      <th className="flex flex-1 flex-row items-center justify-between px-6 py-3 text-left text-sm font-semibold">
                        {model.type !== 'cloud' ? 'Version' : 'Models'}
                      </th>
                      {model.type !== 'cloud' && (
                        <>
                          <th></th>
                          <th className="hidden max-w-32 px-6 py-3 text-left text-sm font-semibold sm:table-cell">
                            Format
                          </th>
                          <th className="hidden max-w-32 px-6 py-3 text-left text-sm font-semibold sm:table-cell">
                            Size
                          </th>
                        </>
                      )}
                      <th className="w-[120px]">
                        {model.type === 'cloud' && (
                          <RemoteModelRefresh engine={model.id} />
                        )}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {model.models?.map((item, i) => {
                      return (
                        <tr
                          key={item.id}
                          className="border-t border-[hsla(var(--app-border))] font-medium text-[hsla(var(--text-secondary))]"
                        >
                          <td className="flex items-center space-x-4 px-6 py-4">
                            <span className="line-clamp-1">
                              {model.type === 'cloud'
                                ? item.id
                                : item.id?.split(':')?.pop()}
                            </span>
                            {i === 0 && model.type !== 'cloud' && (
                              <Badge
                                theme="secondary"
                                className="inline-flex w-[60px] items-center font-medium"
                              >
                                <span>Default</span>
                              </Badge>
                            )}
                          </td>
                          {model.type !== 'cloud' && (
                            <>
                              <td>
                                <ModelLabel size={item.size} compact />
                              </td>
                              <td className="hidden px-6 py-4 sm:table-cell">
                                GGUF
                              </td>
                              <td className="hidden px-6 py-4 text-[hsla(var(--text-secondary))] sm:table-cell">
                                {toGigabytes(item.size)}
                              </td>
                            </>
                          )}
                          <td className="pr-4 text-right">
                            {(model.type !== 'cloud' ||
                              (model.metadata?.apiKey?.length ?? 0) > 0) && (
                              <ModelDownloadButton
                                id={item.id}
                                theme={i === 0 ? 'primary' : 'ghost'}
                                className={
                                  i !== 0
                                    ? '!bg-[hsla(var(--secondary-bg))]'
                                    : ''
                                }
                              />
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            {/* README */}
            <div className="mt-8 flex w-full flex-col items-start justify-between sm:flex-row">
              <MarkdownTextMessage
                text={removeYamlFrontMatter(model.metadata?.description ?? '')}
                className="h-full w-full text-[hsla(var(--text-secondary))]"
              />
            </div>
          </div>
        </div>
      </div>
    </ScrollArea>
  )
}

export default ModelPage
