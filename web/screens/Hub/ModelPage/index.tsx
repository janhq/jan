import { ModelSource } from '@janhq/core'
import { Badge, Button, ScrollArea } from '@janhq/joi'
import { useSetAtom } from 'jotai'
import { ArrowLeftIcon, DownloadIcon, FileJson } from 'lucide-react'
import '@/styles/components/marked.scss'

import ModelDownloadButton from '@/containers/ModelDownloadButton'

import { MainViewState } from '@/constants/screens'

import { MarkdownTextMessage } from '@/screens/Thread/ThreadCenterPanel/TextMessage/MarkdownTextMessage'

import { toGigabytes } from '@/utils/converter'
import { extractModelName } from '@/utils/modelSource'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'
import { selectedSettingAtom } from '@/helpers/atoms/Setting.atom'

type Props = {
  model: ModelSource
  onGoBack: () => void
}

const ModelPage = ({ model, onGoBack }: Props) => {
  const setSelectedSetting = useSetAtom(selectedSettingAtom)
  const setMainViewState = useSetAtom(mainViewStateAtom)
  return (
    <ScrollArea data-testid="hub-container-test-id" className="h-full w-full">
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
                {extractModelName(model.metadata.id)}
              </span>
              <div className="inline-flex items-center space-x-2">
                {model.type !== 'cloud' ? (
                  <ModelDownloadButton id={model.models?.[0].id} />
                ) : (
                  <>
                    {!model.metadata?.apiKey?.length && (
                      <Button
                        onClick={() => {
                          setSelectedSetting(model.id)
                          setMainViewState(MainViewState.Settings)
                        }}
                      >
                        Set Up
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
            <div className="mb-6 flex flex-row divide-x">
              {model.metadata?.author && (
                <p
                  className="font-regular mt-3 line-clamp-1 pr-4 capitalize text-[hsla(var(--text-secondary))]"
                  title={model.metadata?.author}
                >
                  {model.metadata?.author}
                </p>
              )}
              <p className="font-regular mt-3 line-clamp-1 flex flex-row items-center pl-4 pr-4 text-[hsla(var(--text-secondary))] first:pl-0">
                <FileJson size={16} className="mr-2" />
                {model.models?.length}{' '}
                {model.type === 'cloud' ? 'models' : 'versions'}
              </p>
              {model.metadata?.downloads && (
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
                      <th className="flex-1 px-6 py-3 text-left text-sm font-semibold">
                        {model.type !== 'cloud' ? 'Version' : 'Models'}
                      </th>
                      {model.type !== 'cloud' && (
                        <>
                          <th className="max-w-32 px-6 py-3 text-left text-sm font-semibold">
                            Format
                          </th>
                          <th className="max-w-32 px-6 py-3 text-left text-sm font-semibold">
                            Size
                          </th>
                        </>
                      )}
                      <th className="w-[120px]"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {model.models?.map((item, i) => {
                      return (
                        <tr
                          key={item.id}
                          className="border-t border-[hsla(var(--app-border))] font-medium text-[hsla(var(--text-secondary))]"
                        >
                          <td className="flex items-center space-x-4 px-6 py-4 text-black">
                            <span className="line-clamp-1">{item.id}</span>
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
                              <td className="px-6 py-4">GGUF</td>
                              <td className="px-6 py-4 text-[hsla(var(--text-secondary))]">
                                {toGigabytes(item.size)}
                              </td>
                            </>
                          )}
                          <td className="pr-4 text-right text-black">
                            {(model.type !== 'cloud' ||
                              (model.metadata?.apiKey?.length ?? 0) > 0) && (
                              <ModelDownloadButton
                                id={item.id}
                                theme={i === 0 ? 'primary' : 'ghost'}
                                variant={i === 0 ? 'solid' : 'outline'}
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
                text={model.metadata?.description ?? ''}
                className="markdown-content h-full"
              />
            </div>
          </div>
        </div>
      </div>
    </ScrollArea>
  )
}

export default ModelPage
