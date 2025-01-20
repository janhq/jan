import { useEffect, useState } from 'react'

import { Model } from '@janhq/core'
import { Badge, Button } from '@janhq/joi'
import { ArrowLeftIcon } from 'lucide-react'
import { Marked, Renderer } from 'marked'
import '@/styles/components/marked.scss'

type Props = {
  model: Model
  onGoBack: () => void
}

const marked: Marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    link: (href, title, text) => {
      return Renderer.prototype.link
        ?.apply(this, [href, title, text])
        .replace(
          '<a',
          "<a class='text-[hsla(var(--app-link))]' target='_blank'"
        )
    },
  },
})

const ModelPage = ({ model, onGoBack }: Props) => {
  const [description, setDescription] = useState('')

  return (
    <div className="flex h-full w-full justify-center">
      <div className="flex w-full max-w-[800px] flex-col ">
        <div className="top-0 flex h-12 items-center bg-[hsla(var(--app-bg))] px-4">
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
            <span className="line-clamp-1 text-base font-medium group-hover:text-blue-500 group-hover:underline">
              {model.name}
            </span>
            <div className="inline-flex items-center space-x-2">
              <Button
                onClick={(e) => {
                  e.stopPropagation()
                  // onDownloadClick()
                }}
              >
                Download
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-y-4 sm:flex-row sm:gap-x-10 sm:gap-y-0">
            <p
              className="font-regular mt-2 line-clamp-1 text-[hsla(var(--text-secondary))]"
              title={model.metadata?.author}
            >
              {model.metadata?.author}
            </p>
          </div>
          {/* Table of versions */}
          <div className="mt-8 flex w-full flex-col items-start justify-between sm:flex-row">
            <div className="w-full flex-shrink-0 rounded-lg border border-[hsla(var(--app-border))] text-[hsla(var(--text-secondary))]">
              <table className="w-full p-4">
                <thead className="bg-[hsla(var(--tertiary-bg))]">
                  <tr>
                    <th className="flex-1 px-6 py-3 text-left text-sm font-semibold">
                      Version
                    </th>
                    <th className="w-32 px-6 py-3 text-left text-sm font-semibold">
                      Format
                    </th>
                    <th className="w-32 px-6 py-3 text-left text-sm font-semibold">
                      Size
                    </th>
                    <th className="w-[120px]"></th>
                  </tr>
                </thead>
                <tbody>
                  {['8b-gguf', '8b-instruct-fp16']?.map((item, i) => {
                    return (
                      <tr
                        key={item}
                        className="border-t border-[hsla(var(--app-border))] font-medium text-[hsla(var(--text-secondary))]"
                      >
                        <td className="flex items-center space-x-4 px-6 py-4 text-black">
                          <span>8b-gguf</span>
                          {i === 0 && (
                            <Badge
                              theme="secondary"
                              className="inline-flex w-[60px] items-center"
                            >
                              <span>Default</span>
                            </Badge>
                          )}
                        </td>
                        <td className="px-6 py-4">GGUF</td>
                        <td className="px-6 py-4">4.08GB</td>
                        <td className="text-black">
                          <Button
                            theme={i === 0 ? 'primary' : 'ghost'}
                            variant={i === 0 ? 'solid' : 'outline'}
                            onClick={(e) => {
                              e.stopPropagation()
                              // onDownloadClick()
                            }}
                          >
                            Download
                          </Button>
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
            <div
              className="markdown-content font-medium leading-relaxed text-[hsla(var(--text-secondary))]"
              dangerouslySetInnerHTML={{
                __html: marked.parse(description, {
                  async: false,
                }),
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export default ModelPage
