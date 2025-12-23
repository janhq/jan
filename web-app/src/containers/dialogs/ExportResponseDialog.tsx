import { useState, useRef, useMemo, useEffect } from 'react'
import { ThreadMessage } from '@janhq/core'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  IconDownload,
  IconFileText,
  IconFile,
  IconPhoto,
  IconLoader2,
} from '@tabler/icons-react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useReactToPrint } from 'react-to-print'
import { RenderMarkdown } from '../RenderMarkdown'
import {
  exportResponseAsMarkdown,
  downloadMarkdownFile,
  downloadImageFile,
} from '@/lib/exportResponse'
import { toast } from 'sonner'
import twemoji from '@twemoji/api'

export type ExportFormat = 'markdown' | 'pdf' | 'image'

interface ExportResponseDialogProps {
  message: ThreadMessage
  triggerElement?: React.ReactNode
}

const EXPORT_FORMATS = [
  {
    id: 'markdown' as const,
    label: 'Markdown',
    icon: IconFileText,
    description: 'Export as .md file',
  },
  {
    id: 'pdf' as const,
    label: 'PDF',
    icon: IconFile,
    description: 'Export as PDF document',
  },
  {
    id: 'image' as const,
    label: 'Image',
    icon: IconPhoto,
    description: 'Export as PNG image',
  },
]

export function ExportResponseDialog({
  message,
  triggerElement,
}: ExportResponseDialogProps) {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat | null>(
    null
  )
  const [includeThinking, setIncludeThinking] = useState(false)
  const [isExporting, setIsExporting] = useState(false) // Track export state
  const [markdownContent, setMarkdownContent] = useState<string>('')

  const exportButtonRef = useRef<HTMLButtonElement>(null)
  const printContentRef = useRef<HTMLDivElement>(null)

  // Parse emojis in print content
  useEffect(() => {
    if (
      printContentRef.current &&
      selectedFormat === 'pdf' &&
      markdownContent
    ) {
      twemoji.parse(printContentRef.current, {
        base: '/twemoji',
        folder: '/png',
        ext: '.png',
      })
    }
  }, [markdownContent, selectedFormat])

  // Extract response text and thinking from message
  const { thinkingText } = useMemo(() => {
    const text =
      message.content.find((e) => e.type === 'text')?.text?.value ?? ''

    // Check for thinking formats
    const hasThinkTag = text.includes('<think>') && !text.includes('</think>')
    const hasAnalysisChannel =
      text.includes('<|channel|>analysis<|message|>') &&
      !text.includes('<|start|>assistant<|channel|>final<|message|>')

    if (hasThinkTag || hasAnalysisChannel)
      return { responseText: '', thinkingText: text }

    // Check for completed think tag format
    const thinkMatch = text.match(/<think>([\s\S]*?)<\/think>/)
    if (thinkMatch?.index !== undefined) {
      const splitIndex = thinkMatch.index + thinkMatch[0].length
      return {
        thinkingText: text.slice(0, splitIndex),
        responseText: text.slice(splitIndex),
      }
    }

    // Check for completed analysis channel format
    const analysisMatch = text.match(
      /<\|channel\|>analysis<\|message\|>([\s\S]*?)<\|start\|>assistant<\|channel\|>final<\|message\|>/
    )
    if (analysisMatch?.index !== undefined) {
      const splitIndex = analysisMatch.index + analysisMatch[0].length
      return {
        thinkingText: text.slice(0, splitIndex),
        responseText: text.slice(splitIndex),
      }
    }

    return { responseText: text, thinkingText: undefined }
  }, [message.content])

  const pageStyle = `
    img.emoji, img.twemoji {
      display: inline-block !important;
      height: 1em !important;
      width: 1em !important;
      margin: 0 .05em 0 .1em !important;
      vertical-align: -0.1em !important;
    }

    @media print {
      html, body {
        height: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
      }
    }

    body {
      font-size: 14px !important;
      line-height: 1.5 !important;
    }
`

  // Setup react-to-print
  const handlePrint = useReactToPrint({
    contentRef: printContentRef,
    documentTitle: `response-${new Date().toISOString().split('T')[0]}-${Math.random().toString(36).substring(2, 8)}`,
    ignoreGlobalStyles: false,
    pageStyle: pageStyle,
  })

  // Load markdown content when needed for PDF or Image
  useMemo(() => {
    if (selectedFormat === 'pdf' || selectedFormat === 'image') {
      const format = selectedFormat === 'pdf' ? 'pdf' : 'image'
      exportResponseAsMarkdown(message, includeThinking, format).then(
        setMarkdownContent
      )
    }
  }, [message, includeThinking, selectedFormat])

  const handleExport = async () => {
    if (!selectedFormat) return

    try {
      setIsExporting(true)

      // Handle built-in exports
      if (selectedFormat === 'markdown') {
        await downloadMarkdownFile(message, includeThinking)
        setIsOpen(false)
        setSelectedFormat(null)
        setIncludeThinking(false)
        toast.success(
          t('common:toast.markdownDownloaded.title') ||
            'Markdown file downloaded successfully'
        )
      } else if (selectedFormat === 'pdf') {
        // Trigger print dialog for PDF
        // Wait for content to render
        await new Promise((resolve) => setTimeout(resolve, 100))
        handlePrint()
        setIsOpen(false)
        setSelectedFormat(null)
        setIncludeThinking(false)
      } else if (selectedFormat === 'image') {
        if (printContentRef.current) {
          // Wait for content to render
          await new Promise((resolve) => setTimeout(resolve, 100))
          await downloadImageFile(printContentRef.current)
        }
        setIsOpen(false)
        setSelectedFormat(null)
        setIncludeThinking(false)
        toast.success(
          t('common:toast.imageDownloaded.title') ||
            'Image file downloaded successfully'
        )
      }
    } catch (error) {
      console.error('Export failed:', error)
      toast.error('Export failed')
    } finally {
      setIsExporting(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && selectedFormat && !isExporting) {
      e.preventDefault()
      handleExport()
    }
  }

  const defaultTrigger = (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="flex items-center gap-1 hover:text-accent transition-colors cursor-pointer group relative"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setIsOpen(true)
            }
          }}
        >
          <IconDownload size={16} />
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <p>{t('common:dialogs.exportResponse.export') || 'Export'}</p>
      </TooltipContent>
    </Tooltip>
  )

  return (
    <>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogTrigger>{triggerElement || defaultTrigger}</DialogTrigger>
        <DialogContent
          className="sm:max-w-md"
          onOpenAutoFocus={(e) => {
            e.preventDefault()
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {t('common:dialogs.exportResponse.title') || 'Export Response'}
            </DialogTitle>
            <DialogDescription>
              {t('common:dialogs.exportResponse.description') ||
                'Select an export format and choose whether to include the thinking process.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Export Format Selection */}
            <div>
              <h3 className="text-sm font-semibold mb-3">
                {t('common:dialogs.exportResponse.format') || 'Format'}
              </h3>
              <div className="grid grid-cols-3 gap-2">
                {EXPORT_FORMATS.map((format) => {
                  const Icon = format.icon
                  return (
                    <button
                      key={format.id}
                      onClick={() => setSelectedFormat(format.id)}
                      className={`flex flex-col items-center gap-2 p-3 rounded-lg border-2 transition-all ${
                        selectedFormat === format.id
                          ? 'border-accent bg-accent/10'
                          : 'border-main-view-fg/10 hover:border-main-view-fg/20'
                      }`}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setSelectedFormat(format.id)
                        }
                      }}
                      tabIndex={0}
                    >
                      <Icon size={20} className="opacity-80" />
                      <span className="text-xs font-medium">
                        {format.label}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Include Thinking Toggle */}
            {thinkingText && (
              <div className="border-t border-main-view-fg/10 pt-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold">
                      {t('common:dialogs.exportResponse.thinking') ||
                        'Include Thinking Process'}
                    </h3>
                    <p className="text-xs text-main-view-fg/60 mt-1">
                      {t(
                        'common:dialogs.exportResponse.includingThinkingDescription'
                      ) ||
                        "Include the model's reasoning process in the export"}
                    </p>
                  </div>
                  <Switch
                    checked={includeThinking}
                    onCheckedChange={setIncludeThinking}
                    aria-label={
                      t('common:dialogs.exportResponse.thinking') ||
                      'Include Thinking Process'
                    }
                  />
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <DialogClose asChild>
              <Button variant="link" size="sm" className="w-full sm:w-auto">
                {t('common:dialogs.exportResponse.cancel') || 'Cancel'}
              </Button>
            </DialogClose>
            <Button
              ref={exportButtonRef}
              disabled={!selectedFormat || isExporting}
              onClick={handleExport}
              onKeyDown={handleKeyDown}
              size="sm"
              className="w-full sm:w-auto"
              aria-label={t('common:dialogs.exportResponse.export') || 'Export'}
            >
              {isExporting ? (
                <>
                  <IconLoader2 size={16} className="animate-spin mr-2" />
                  {t('common:dialogs.exportResponse.exporting') ||
                    'Exporting...'}
                </>
              ) : (
                <>
                  <IconDownload size={16} className="mr-2" />
                  {t('common:dialogs.exportResponse.export') || 'Export'}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hidden content for PDF printing and Image generation */}
      {isOpen && (selectedFormat === 'pdf' || selectedFormat === 'image') && (
        <div
          style={{
            position: 'fixed',
            opacity: 0,
            pointerEvents: 'none',
            left: '-10000px',
            top: 0,
            width: '800px',
            zIndex: -1,
            overflow: 'hidden',
          }}
        >
          <div ref={printContentRef}>
            <RenderMarkdown content={markdownContent} enableRawHtml={true} />
          </div>
        </div>
      )}
    </>
  )
}
