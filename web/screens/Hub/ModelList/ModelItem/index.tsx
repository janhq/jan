import Markdown from 'react-markdown'

import Image from 'next/image'

import { ModelSource } from '@janhq/core'

import { DownloadIcon, FileJson } from 'lucide-react'

import ModelLabel from '@/containers/ModelLabel'

import ModelItemHeader from '@/screens/Hub/ModelList/ModelHeader'

import { markdownComponents } from '@/screens/Thread/ThreadCenterPanel/TextMessage/MarkdownUtils'

import { toGigabytes } from '@/utils/converter'
import { extractDescription } from '@/utils/modelSource'
import '@/styles/components/model.scss'

type Props = {
  model: ModelSource
  onSelectedModel: () => void
}

const ModelItem: React.FC<Props> = ({ model, onSelectedModel }) => {
  return (
    <div className="mb-6 flex w-full flex-col overflow-hidden border-b border-[hsla(var(--app-border))] py-4">
      <ModelItemHeader model={model} onSelectedModel={onSelectedModel} />

      <div className="flex w-full">
        <div className="flex w-full flex-col ">
          <div className="my-2 inline-flex items-center sm:hidden">
            <span className="mr-4">{toGigabytes(model.models?.[0]?.size)}</span>
            <ModelLabel size={model.models?.[0]?.size} />
          </div>
          <div className="flex flex-col">
            <Markdown
              className="md-short-desc line-clamp-3 max-w-full overflow-hidden font-light text-[hsla(var(--text-secondary))]"
              components={markdownComponents}
            >
              {extractDescription(model.metadata?.description) || '-'}
            </Markdown>
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
                )}{' '}
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
        </div>
      </div>
    </div>
  )
}

export default ModelItem
