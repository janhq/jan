import {
  ChevronDown,
  ChevronUp,
  Loader,
  Terminal,
  Box,
  CheckCircle2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { create } from 'zustand'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import { memo, useMemo, useState } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import ImageModal from '@/containers/dialogs/ImageModal'

// --- Types & Store ---
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
      collapseState: { ...state.collapseState, [id]: expanded },
    })),
}))

// --- Helpers ---
const createDataUrl = (base64Data: string, mimeType: string) =>
  base64Data.startsWith('data:')
    ? base64Data
    : `data:${mimeType};base64,${base64Data}`

const parseMCPResponse = (result: string) => {
  try {
    const parsed = JSON.parse(result)
    return {
      contentItems: parsed.content || [],
      parsedResult: parsed,
      hasStructuredContent: !!parsed.content,
    }
  } catch {
    return {
      contentItems: [],
      parsedResult: result,
      hasStructuredContent: false,
    }
  }
}

// --- Sub-Components ---
const ContentItemRenderer = memo(({ item, index, onImageClick }: any) => {
  if (item.type === 'image' && item.data && item.mimeType) {
    const imageUrl = createDataUrl(item.data, item.mimeType)
    return (
      <div className="group relative my-4 overflow-hidden rounded-xl border border-main-view-fg/10 bg-black/20">
        <img
          src={imageUrl}
          alt={`Result ${index}`}
          className="max-h-80 w-full object-contain cursor-zoom-in transition-transform duration-300 hover:scale-[1.02]"
          onClick={() => onImageClick?.(imageUrl, `Result ${index}`)}
        />
      </div>
    )
  }
  return (
    <div className="mt-2 rounded-lg bg-main-view-fg/5 p-2 border border-main-view-fg/5">
      <RenderMarkdown
        content={`\`\`\`json\n${JSON.stringify(item, null, 2)}\n\`\`\``}
      />
    </div>
  )
})

const ToolCallBlock = ({ id, name, result, loading, args }: Props) => {
  const { collapseState, setCollapseState } = useToolCallBlockStore()
  const { t } = useTranslation()
  const [modalImage, setModalImage] = useState<{
    url: string
    alt: string
  } | null>(null)

  const isExpanded = collapseState[id] ?? loading
  const { parsedResult, contentItems, hasStructuredContent } = useMemo(
    () => parseMCPResponse(result),
    [result]
  )

  return (
    <div className="group mx-auto w-full my-4 overflow-hidden rounded-2xl border border-main-view-fg/10 bg-main-view-fg/[0.02] shadow-sm">
      <div
        onClick={() => setCollapseState(id, !isExpanded)}
        className="flex cursor-pointer items-center justify-between p-3 transition-colors hover:bg-main-view-fg/[0.04]"
      >
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'flex size-8 items-center justify-center rounded-xl border transition-all',
              loading
                ? 'border-primary/30 bg-primary/10 animate-pulse'
                : 'border-main-view-fg/10 bg-main-view-fg/5'
            )}
          >
            {loading ? (
              <Loader className="size-4 animate-spin text-primary" />
            ) : (
              <Terminal className="size-4 text-main-view-fg/60" />
            )}
          </div>

          <div className="flex flex-col">
            <span className="text-sm font-bold tracking-tight text-main-view-fg/90">
              {name}
            </span>
            <div className="flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-widest text-main-view-fg/40">
              {loading ? (
                <span className="text-primary">{t('common:callingTool')}</span>
              ) : (
                <span className="flex items-center gap-1 text-emerald-500">
                  <CheckCircle2 size={10} /> {t('common:completed')}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center pr-1">
          {isExpanded ? (
            <ChevronUp className="size-4 opacity-40" />
          ) : (
            <ChevronDown className="size-4 opacity-40" />
          )}
        </div>
      </div>

      <div
        className={cn(
          'grid transition-all duration-300 ease-in-out',
          isExpanded
            ? 'grid-rows-[1fr] opacity-100'
            : 'grid-rows-[0fr] opacity-0'
        )}
      >
        <div className="overflow-hidden">
          <div className="p-4 pt-0 space-y-4">
            {/* Arguments Section */}
            {args && Object.keys(args).length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-[11px] font-bold text-main-view-fg/30 uppercase tracking-tighter">
                  <Box size={12} /> {t('common:parameters')}
                </div>
                <div className="rounded-xl bg-black/10 p-2 border border-white/5 font-mono text-[13px]">
                  <RenderMarkdown
                    content={`\`\`\`json\n${JSON.stringify(args, null, 2)}\n\`\`\``}
                  />
                </div>
              </div>
            )}

            {/* Result Section */}
            {result && (
              <div className="space-y-1.5 border-t border-main-view-fg/5 pt-4">
                <div className="text-[11px] font-bold text-main-view-fg/30 uppercase tracking-tighter">
                  {t('common:output')}
                </div>
                <div className="text-sm text-main-view-fg/70">
                  {hasStructuredContent ? (
                    <div className="space-y-2">
                      {contentItems.map((item: any, idx: number) => (
                        <ContentItemRenderer
                          key={idx}
                          item={item}
                          index={idx}
                          onImageClick={(url: string, alt: string) =>
                            setModalImage({ url, alt })
                          }
                        />
                      ))}
                    </div>
                  ) : (
                    <RenderMarkdown
                      content={`\`\`\`json\n${JSON.stringify(parsedResult, null, 2)}\n\`\`\``}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <ImageModal image={modalImage} onClose={() => setModalImage(null)} />
    </div>
  )
}

export default memo(ToolCallBlock)
