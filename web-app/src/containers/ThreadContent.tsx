import { ThreadMessage } from '@janhq/core'
import { RenderMarkdown } from './RenderMarkdown'
import { Fragment, memo, useMemo, useState } from 'react'
import { IconCopy, IconCopyCheck, IconRefresh } from '@tabler/icons-react'

const CopyButton = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      className="flex items-center gap-1 hover:text-accent transition-colors"
      onClick={handleCopy}
    >
      {copied ? (
        <>
          <IconCopyCheck size={16} className="text-accent" />
          <span>Copied!</span>
        </>
      ) : (
        <>
          <IconCopy size={16} />
          <span>Copy</span>
        </>
      )}
    </button>
  )
}

// Use memo to prevent unnecessary re-renders, but allow re-renders when props change
export const ThreadContent = memo(
  (item: ThreadMessage & { isLastMessage?: boolean }) => {
    // Use useMemo to stabilize the components prop
    const linkComponents = useMemo(
      () => ({
        a: ({ ...props }) => (
          <a {...props} target="_blank" rel="noopener noreferrer" />
        ),
      }),
      []
    )
    const image = useMemo(() => item.content?.[0]?.image_url, [item])

    console.log(item)

    return (
      <Fragment>
        {item.content?.[0]?.text && item.role === 'user' && (
          <div className="flex justify-end w-full">
            <div className="bg-accent text-accent-fg p-2 rounded-md inline-block">
              <p>{item.content?.[0].text.value}</p>
            </div>
          </div>
        )}
        {item.content?.[0]?.text && item.role !== 'user' && (
          <>
            <RenderMarkdown
              content={item.content?.[0]?.text.value}
              components={linkComponents}
            />
            <div className="flex items-center gap-2 mt-2 text-sm text-main-view-fg/60">
              {item.isLastMessage && item.role === 'assistant' && (
                <div className="flex items-center gap-1">
                  <span className="text-xs">Speed: 42 tokens/sec</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <CopyButton text={item.content?.[0]?.text.value || ''} />
                <button
                  className="flex items-center gap-1 hover:text-accent transition-colors cursor-pointer"
                  onClick={() => {
                    console.log('Regenerate clicked')
                  }}
                >
                  <IconRefresh size={16} />
                  <span>Regenerate</span>
                </button>
              </div>
            </div>
          </>
        )}
        {item.type === 'image_url' && image && (
          <div>
            <img
              src={image.url}
              alt={image.detail || 'Thread image'}
              className="max-w-full rounded-md"
            />
            {image.detail && <p className="text-sm mt-1">{image.detail}</p>}
          </div>
        )}
      </Fragment>
    )
  }
)
