import { X, Copy, Download, Check } from 'lucide-react'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import { useState, useEffect, useMemo } from 'react'
import ImageModal from '@/containers/dialogs/ImageModal'
import { useTranslation } from '@/i18n/react-i18next-compat'
import type { PanelData } from '@/hooks/useToolCallPanel'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { MermaidRenderer } from '@/components/MermaidRenderer'

interface Props {
  panelData: PanelData
  onClose: () => void
}

// Types for MCP response content
interface MCPContentItem {
  type: string
  data?: string
  text?: string
  mimeType?: string
}

interface MCPResponse {
  content?: MCPContentItem[]
}

// Utility function to create data URL from base64 and mimeType
const createDataUrl = (base64Data: string, mimeType: string): string => {
  if (base64Data.startsWith('data:')) {
    return base64Data
  }
  return `data:${mimeType};base64,${base64Data}`
}

// Parse MCP response and extract content items
const parseMCPResponse = (result: string) => {
  try {
    const parsed: MCPResponse = JSON.parse(result)
    const content = parsed.content || []

    return {
      parsedResult: parsed,
      contentItems: content,
      hasStructuredContent: content.length > 0,
      parseError: false,
    }
  } catch {
    return {
      parsedResult: result,
      contentItems: [],
      hasStructuredContent: false,
      parseError: true,
    }
  }
}

// Component to render individual content items based on type
const ContentItemRenderer = ({
  item,
  index,
  onImageClick,
}: {
  item: MCPContentItem
  index: number
  onImageClick?: (imageUrl: string, alt: string) => void
}) => {
  if (item.type === 'image' && item.data && item.mimeType) {
    const imageUrl = createDataUrl(item.data, item.mimeType)
    return (
      <div key={index} className="my-3">
        <img
          src={imageUrl}
          alt={`Result image ${index + 1}`}
          className="max-w-full max-h-96 object-contain rounded-md border border-main-view-fg/10 cursor-pointer hover:opacity-80 transition-opacity"
          onError={(e) => {
            e.currentTarget.style.display = 'none'
          }}
          onClick={() => onImageClick?.(imageUrl, `Result image ${index + 1}`)}
        />
      </div>
    )
  }

  // For text type, render as plain text
  if (item.type === 'text' && item.text) {
    return (
      <div key={index} className="my-3">
        <RenderMarkdown content={item.text} />
      </div>
    )
  }

  // For any other types, render as JSON
  return (
    <div key={index} className="mt-3">
      <RenderMarkdown
        content={'```json\n' + JSON.stringify(item, null, 2) + '\n```'}
      />
    </div>
  )
}

export const SidePreviewPanel = ({ panelData, onClose }: Props) => {
  const { t } = useTranslation()
  const [modalImage, setModalImage] = useState<{
    url: string
    alt: string
  } | null>(null)
  const [copied, setCopied] = useState(false)

  // Handle ESC key to close panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleImageClick = (imageUrl: string, alt: string) => {
    setModalImage({ url: imageUrl, alt })
  }

  const closeModal = () => {
    setModalImage(null)
  }

  const handleCopy = () => {
    let contentToCopy: string

    if (panelData.type === 'tool_call') {
      contentToCopy = JSON.stringify(
        {
          name: panelData.data.name,
          args: panelData.data.args,
          result: panelData.data.result,
        },
        null,
        2
      )
    } else if (panelData.type === 'mermaid') {
      contentToCopy = panelData.data.code
    } else {
      contentToCopy = panelData.data.content
    }

    navigator.clipboard.writeText(contentToCopy)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDownload = () => {
    let contentToDownload: string
    let filename: string

    if (panelData.type === 'tool_call') {
      contentToDownload = JSON.stringify(
        {
          name: panelData.data.name,
          args: panelData.data.args,
          result: panelData.data.result,
        },
        null,
        2
      )
      filename = `tool-call-${panelData.data.name}-${Date.now()}.json`
    } else if (panelData.type === 'mermaid') {
      contentToDownload = panelData.data.code
      filename = `mermaid-diagram-${Date.now()}.mmd`
    } else if (panelData.type === 'thinking') {
      contentToDownload = panelData.data.content
      filename = `thinking-${panelData.data.id}-${Date.now()}.md`
    } else {
      contentToDownload = panelData.data.content
      filename = `message-${panelData.data.id}-${Date.now()}.md`
    }

    const blob = new Blob([contentToDownload], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // Compute panel content based on type
  const panelContent = useMemo(() => {
    if (panelData.type === 'tool_call') {
      const { name, args, result } = panelData.data
      const { parsedResult, contentItems, hasStructuredContent } =
        parseMCPResponse(result)
      return {
        title: name,
        subtitle: t('common:toolOutput'),
        showArgs: true,
        args,
        content: result,
        parsedResult,
        contentItems,
        hasStructuredContent,
      }
    } else if (panelData.type === 'thinking') {
      // thinking type
      const { content } = panelData.data
      return {
        title: t('common:thought'),
        subtitle: t('common:reasoning'),
        showArgs: false,
        args: {},
        content,
        parsedResult: content,
        contentItems: [],
        hasStructuredContent: false,
      }
    } else if (panelData.type === 'mermaid') {
      // mermaid type
      const { code, title } = panelData.data
      return {
        title: title || 'Mermaid Diagram',
        subtitle: t('common:diagram'),
        showArgs: false,
        args: {},
        content: code,
        parsedResult: code,
        contentItems: [],
        hasStructuredContent: false,
      }
    } else {
      // message type
      const { content, role } = panelData.data
      return {
        title: role === 'assistant' ? 'Assistant' : 'User',
        subtitle: t('common:messageContent'),
        showArgs: false,
        args: {},
        content,
        parsedResult: content,
        contentItems: [],
        hasStructuredContent: false,
      }
    }
  }, [panelData, t])

  return (
    <>
      {/* Backdrop - only on mobile */}
      <div
        className="fixed inset-0 bg-black/50 z-40 md:hidden backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel - relative positioning for split screen on desktop */}
      <div className="fixed md:relative inset-y-0 right-0 w-full md:w-[400px] lg:w-[500px] bg-main-view-bg border-l border-main-view-fg/10 shadow-2xl z-50 flex flex-col flex-shrink-0 animate-in slide-in-from-right md:slide-in-from-right-0 duration-300">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-main-view-fg/10">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-main-view-fg truncate">
              {panelContent.title}
            </h2>
            <p className="text-xs text-main-view-fg/60 mt-0.5">
              {panelContent.subtitle}
            </p>
          </div>
          <div className="flex items-center gap-1 ml-3 flex-shrink-0">
            {/* Copy Button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleCopy}
                  className="p-1.5 rounded-md hover:bg-main-view-fg/10 transition-colors"
                  aria-label="Copy content"
                >
                  {copied ? (
                    <Check className="w-4 h-4 text-accent" />
                  ) : (
                    <Copy className="w-4 h-4 text-main-view-fg/60" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{copied ? t('common:copied') : t('common:copy')}</p>
              </TooltipContent>
            </Tooltip>

            {/* Download Button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleDownload}
                  className="p-1.5 rounded-md hover:bg-main-view-fg/10 transition-colors"
                  aria-label="Download content"
                >
                  <Download className="w-4 h-4 text-main-view-fg/60" />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t('common:download')}</p>
              </TooltipContent>
            </Tooltip>

            {/* Close Button */}
            <button
              onClick={onClose}
              className="p-1.5 rounded-md hover:bg-main-view-fg/10 transition-colors"
              aria-label="Close panel"
            >
              <X className="w-5 h-5 text-main-view-fg/60" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Arguments Section - only for tool calls */}
          {panelContent.showArgs &&
            panelContent.args &&
            Object.keys(panelContent.args).length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-main-view-fg/80 mb-2">
                  {t('common:arguments')}
                </h3>
                <div className="bg-main-view-fg/4 rounded-lg p-3 border border-main-view-fg/10">
                  <RenderMarkdown
                    isWrapping={true}
                    content={
                      '```json\n' +
                      JSON.stringify(panelContent.args, null, 2) +
                      '\n```'
                    }
                  />
                </div>
              </div>
            )}

          {/* Output/Content Section */}
          {panelContent.content && (
            <div>
              <h3 className="text-sm font-medium text-main-view-fg/80 mb-2">
                {panelData.type === 'tool_call'
                  ? t('common:output')
                  : t('common:content')}
              </h3>
              <div className="bg-main-view-fg/4 rounded-lg p-3 border border-main-view-fg/10">
                {panelContent.hasStructuredContent ? (
                  <div className="space-y-2">
                    {panelContent.contentItems.map((item, index) => (
                      <ContentItemRenderer
                        key={index}
                        item={item}
                        index={index}
                        onImageClick={handleImageClick}
                      />
                    ))}
                  </div>
                ) : panelData.type === 'mermaid' ? (
                  // For mermaid diagrams, render with MermaidRenderer
                  <div className="p-4">
                    <MermaidRenderer chart={panelContent.content} />
                  </div>
                ) : panelData.type === 'message' || panelData.type === 'thinking' ? (
                  // For messages and thinking, render as markdown directly
                  <RenderMarkdown content={panelContent.content} />
                ) : (
                  // For tool calls, render as JSON
                  <RenderMarkdown
                    content={
                      '```json\n' +
                      JSON.stringify(panelContent.parsedResult, null, 2) +
                      '\n```'
                    }
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <ImageModal image={modalImage} onClose={closeModal} />
    </>
  )
}
