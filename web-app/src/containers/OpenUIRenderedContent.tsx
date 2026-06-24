import { RenderMarkdown } from '@/containers/RenderMarkdown'
import {
  OpenUILibraryRenderedContent,
  type OpenUIRenderedContentProps,
} from '@/containers/OpenUILibraryRenderedContent'
import { useOpenUISettings } from '@/hooks/useOpenUISettings'
import { janOpenUIChatLibrary } from '@/lib/openui-chat-library'
import { lazy, Suspense } from 'react'

const OpenUIStandardRenderedContent = lazy(() =>
  import('./OpenUIStandardRenderedContent').then((module) => ({
    default: module.OpenUIStandardRenderedContent,
  }))
)

export function OpenUIRenderedContent(props: OpenUIRenderedContentProps) {
  const componentLibrary = useOpenUISettings((state) => state.componentLibrary)

  if (componentLibrary === 'standard') {
    return (
      <Suspense
        fallback={
          <RenderMarkdown
            content={props.content}
            className={props.className}
            isUser={props.isUser}
            isStreaming={props.isStreaming}
            messageId={props.messageId}
            isAnimating={props.isAnimating}
          />
        }
      >
        <OpenUIStandardRenderedContent {...props} />
      </Suspense>
    )
  }

  return (
    <OpenUILibraryRenderedContent {...props} library={janOpenUIChatLibrary} />
  )
}
