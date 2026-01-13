import { ChevronDown, ChevronUp, Loader } from 'lucide-react'
import { cn } from '@/lib/utils'
import { create } from 'zustand'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import { useMemo, useState } from 'react'
import { twMerge } from 'tailwind-merge'
import { useTranslation } from '@/i18n/react-i18next-compat'
import ImageModal from '@/containers/dialogs/ImageModal'

interface Props {
  result: string
  name: string
  args: object
  id: number
  loading: boolean
}

type ToolCallBlockState = {
  collapseState: { [id: number]: boolean }
  setCollapseState: (id: number, expanded: boolean) => void
}

const useToolCallBlockStore = create<ToolCallBlockState>((set) => ({
  collapseState: {},
  setCollapseState: (id, expanded) =>
    set((state) => ({
      collapseState: {
        ...state.collapseState,
        [id]: expanded,
      },
    })),
}))

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
  // Handle case where base64 data might already include data URL prefix
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
    // Fallback: JSON parsing failed, treat as plain text
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
          className="max-w-full max-h-64 object-contain rounded-md border border-main-view-fg/10 cursor-pointer hover:opacity-80 transition-opacity"
          onError={(e) => {
            // Hide broken images
            e.currentTarget.style.display = 'none'
          }}
          onClick={() => onImageClick?.(imageUrl, `Result image ${index + 1}`)}
        />
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

const ToolCallBlock = ({ id, name, result, loading, args }: Props) => {
  const { collapseState, setCollapseState } = useToolCallBlockStore()
  const { t } = useTranslation()
  const isExpanded = collapseState[id] ?? (loading ? true : false)
  const [modalImage, setModalImage] = useState<{
    url: string
    alt: string
  } | null>(null)

  const handleClick = () => {
    const newExpandedState = !isExpanded
    setCollapseState(id, newExpandedState)
  }

  const handleImageClick = (imageUrl: string, alt: string) => {
    setModalImage({ url: imageUrl, alt })
  }

  const closeModal = () => {
    setModalImage(null)
  }

  // Parse the MCP response and extract content items
  const { parsedResult, contentItems, hasStructuredContent } = useMemo(() => {
    return parseMCPResponse(result)
  }, [result])

  return (
    <div
      className="mx-auto w-full cursor-pointer break-words"
      data-tool-call-block={id}
    >
      <div className="rounded-lg bg-main-view-fg/4 border border-dashed border-main-view-fg/10">
        <div className="flex items-center gap-3 p-2" onClick={handleClick}>
          {loading && (
            <div className="w-4 h-4">
              <Loader className="size-4 animate-spin text-main-view-fg/60" />
            </div>
          )}
          <button className="flex items-center gap-2 focus:outline-none">
            {!loading && (
              <>
                {isExpanded ? (
                  <>
                    <div className="ml-1 w-4 h-4">
                      <ChevronUp className="h-4 w-4" />
                    </div>
                  </>
                ) : (
                  <div className="ml-1 w-4 h-4">
                    <ChevronDown className="h-4 w-4" />
                  </div>
                )}
              </>
            )}
            <span className="font-medium text-main-view-fg/80">
              <span className="font-medium text-main-view-fg mr-2">{name}</span>
              <span
                className={twMerge(
                  'text-xs bg-main-view-fg/4 rounded-sm p-1',
                  loading ? 'text-main-view-fg/40' : 'text-accent'
                )}
              >
                {loading ? t('common:callingTool') : t('common:completed')}{' '}
              </span>
            </span>
          </button>
        </div>

        <div
          className={cn(
            'h-fit w-full overflow-auto transition-all duration-300 px-2',
            isExpanded ? '' : 'max-h-0 overflow-hidden'
          )}
        >
          <div className="mt-2 text-main-view-fg/60 overflow-hidden">
            {args && Object.keys(args).length > 3 && (
              <>
                <p className="mb-3">Arguments:</p>
                <RenderMarkdown
                  content={'```json\n' + args + '\n```'}
                />
              </>
            )}

            {result && (
              <>
                <p>Output:</p>
                {hasStructuredContent ? (
                  /* Render each content item individually based on its type */
                  <div className="space-y-2">
                    {contentItems.map((item, index) => (
                      <ContentItemRenderer
                        key={index}
                        item={item}
                        index={index}
                        onImageClick={handleImageClick}
                      />
                    ))}
                  </div>
                ) : (
                  /* Fallback: render as JSON for valid JSON but unstructured responses */
                  <RenderMarkdown
                    content={
                      '```json\n' +
                      JSON.stringify(parsedResult, null, 2) +
                      '\n```'
                    }
                  />
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <ImageModal image={modalImage} onClose={closeModal} />
    </div>
  )
}

export default ToolCallBlock
