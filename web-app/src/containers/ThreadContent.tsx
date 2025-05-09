import { RenderMarkdown } from './RenderMarkdown'

export const ThreadContent = (item: ThreadContent) => {
  return (
    <div className="mb-4">
      {item.type === 'text' && item.text && item.role === 'user' && (
        <div className="flex justify-end w-full">
          <div className="bg-accent text-accent-fg p-2 rounded-md inline-block">
            <p>{item.text.value}</p>
          </div>
        </div>
      )}
      {item.type === 'text' && item.text && item.role !== 'user' && (
        <RenderMarkdown
          content={item.text.value}
          components={{
            a: ({ ...props }) => (
              <a {...props} target="_blank" rel="noopener noreferrer" />
            ),
          }}
        />
      )}
      {item.type === 'image_url' && item.image_url && (
        <div>
          <img
            src={item.image_url.url}
            alt={item.image_url.detail || 'Thread image'}
            className="max-w-full rounded-md"
          />
          {item.image_url.detail && (
            <p className="text-sm mt-1">{item.image_url.detail}</p>
          )}
        </div>
      )}
    </div>
  )
}
