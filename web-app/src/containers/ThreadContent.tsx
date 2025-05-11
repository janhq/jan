import { ThreadMessage } from '@janhq/core'
import { RenderMarkdown } from './RenderMarkdown'
import { Fragment, memo, useMemo } from 'react'

// Use memo to prevent unnecessary re-renders, but allow re-renders when props change
export const ThreadContent = memo((item: ThreadMessage) => {
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
        <RenderMarkdown
          content={item.content?.[0]?.text.value}
          components={linkComponents}
        />
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
})
