import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FileTextIcon,
  ClockIcon,
  HashIcon,
  InfoIcon,
} from 'lucide-react'
import { getFileIcon } from '@/lib/rag-utils'

interface SourceCitationProps {
  filename: string
  page?: number
  chunkIndex?: number
  score?: number
  className?: string
  // Enhanced properties for rich RAG data
  textChunk?: string
  distance?: number
  documentId?: string
  chunkOrder?: number
  originalPath?: string
  documentType?: string
  sourceInfo?: {
    name: string
    type: string
    status: string
    added_at: string
  }
  queryTimestamp?: string
  expanded?: boolean
}

const SourceCitation = ({
  filename,
  page,
  score,
  className = '',
  textChunk,
  distance,
  documentId,
  chunkOrder,
  originalPath,
  documentType,
  sourceInfo,
  queryTimestamp,
  expanded = false,
}: SourceCitationProps) => {
  const [isExpanded, setIsExpanded] = useState(expanded)

  // Determine if we have rich data to show
  const hasRichData = textChunk || documentId || originalPath || sourceInfo

  // Format the timestamp
  const formatTimestamp = (timestamp?: string) => {
    if (!timestamp) return ''
    try {
      return new Date(timestamp).toLocaleString()
    } catch {
      return timestamp
    }
  }

  // Get score color based on relevance
  const getScoreColor = (relevanceScore?: number) => {
    if (!relevanceScore) return 'bg-gray-100 text-gray-600'
    if (relevanceScore >= 0.7) return 'bg-emerald-100 text-emerald-700'
    if (relevanceScore >= 0.5) return 'bg-amber-100 text-amber-700'
    return 'bg-red-100 text-red-700'
  }

  if (!hasRichData) {
    // Fallback to simple badge for basic data
    return (
      <Badge
        variant="outline"
        className={`inline-flex items-center gap-1.5 text-xs bg-primary/5 border-primary/20 hover:bg-primary/10 transition-all duration-200 cursor-default ${className}`}
        title={`Source: ${filename}${page ? ` (Page ${page})` : ''}${score ? ` - Relevance: ${(score * 100).toFixed(1)}%` : ''}`}
      >
        <span className="text-sm" role="img" aria-label="File type">
          {getFileIcon(filename.toLowerCase().split('.').pop() || 'unknown')}
        </span>
        <span className="truncate max-w-[120px] font-medium text-primary">
          {filename}
        </span>
        {page && (
          <span className="text-primary/70 font-medium text-[10px] bg-primary/10 px-1 rounded">
            p.{page}
          </span>
        )}
        {score && (
          <span className="text-primary font-mono font-semibold text-[10px] bg-primary/15 px-1 rounded">
            {(score * 100).toFixed(0)}%
          </span>
        )}
      </Badge>
    )
  }

  return (
    <div
      className={`w-full bg-primary/5 border border-primary/10 rounded-lg transition-all duration-200 hover:bg-primary/10 ${className}`}
    >
      {/* Header - always visible */}
      <div className="p-3 pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {/* File icon and name */}
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="flex-shrink-0 text-lg">
                {getFileIcon(
                  filename.toLowerCase().split('.').pop() || 'unknown'
                )}
              </div>
              <div className="min-w-0 flex-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <h3 className="text-sm font-medium text-primary truncate cursor-help">
                      {filename}
                    </h3>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="max-w-xs break-all">
                      {originalPath || filename}
                    </p>
                  </TooltipContent>
                </Tooltip>

                {/* Metadata badges */}
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  {documentType && (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-700 border-blue-200"
                    >
                      {documentType.toUpperCase()}
                    </Badge>
                  )}
                  {chunkOrder !== undefined && (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0.5 bg-purple-50 text-purple-700 border-purple-200"
                    >
                      <HashIcon className="w-2.5 h-2.5 mr-1" />#{chunkOrder}
                    </Badge>
                  )}
                  {page && (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0.5 bg-indigo-50 text-indigo-700 border-indigo-200"
                    >
                      <FileTextIcon className="w-2.5 h-2.5 mr-1" />
                      p.{page}
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            {/* Score indicators */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {score && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      className={`text-[10px] px-2 py-1 font-mono font-semibold cursor-help ${getScoreColor(score)}`}
                    >
                      {(score * 100).toFixed(1)}%
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    <div className="text-xs">
                      <p>Similarity Score: {(score * 100).toFixed(2)}%</p>
                      {distance && <p>Distance: {distance.toFixed(4)}</p>}
                    </div>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>

          {/* Expand/collapse button */}
          <Button
            variant="link"
            size="sm"
            className="h-6 w-6 p-0 ml-2 text-primary/60 hover:text-primary"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? (
              <ChevronDownIcon className="h-3 w-3" />
            ) : (
              <ChevronRightIcon className="h-3 w-3" />
            )}
          </Button>
        </div>
      </div>

      {/* Expandable content */}
      {isExpanded && (
        <div className="px-3 pb-3 border-t border-primary/10 pt-3">
          {/* Text chunk preview */}
          {textChunk && (
            <div className="mb-4">
              <h4 className="text-xs font-medium text-main-view-fg/70 mb-2 flex items-center gap-1">
                <FileTextIcon className="w-3 h-3" />
                Content Preview
              </h4>
              <div className="bg-main-view-fg/5 rounded-md p-3 border border-main-view-fg/10">
                <p className="text-xs text-main-view-fg/80 leading-relaxed">
                  {textChunk.length > 200
                    ? `${textChunk.slice(0, 200)}...`
                    : textChunk}
                </p>
              </div>
            </div>
          )}

          {/* Metadata section */}
          <div className="space-y-3">
            <h4 className="text-xs font-medium text-main-view-fg/70 mb-2 flex items-center gap-1">
              <InfoIcon className="w-3 h-3" />
              Details
            </h4>

            <div className="grid grid-cols-1 gap-2 text-xs">
              {documentId && (
                <div className="flex justify-between items-center">
                  <span className="text-main-view-fg/60">Document ID</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <code className="bg-main-view-fg/10 px-2 py-1 rounded text-[10px] font-mono cursor-help">
                        {documentId.slice(0, 8)}...
                      </code>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="font-mono break-all max-w-xs text-xs">
                        {documentId}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              )}

              {sourceInfo?.status && (
                <div className="flex justify-between items-center">
                  <span className="text-main-view-fg/60">Status</span>
                  <Badge
                    variant="outline"
                    className={`text-[10px] px-2 py-0.5 ${
                      sourceInfo.status === 'indexed'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-gray-50 text-gray-700 border-gray-200'
                    }`}
                  >
                    {sourceInfo.status}
                  </Badge>
                </div>
              )}

              {sourceInfo?.added_at && (
                <div className="flex justify-between items-center">
                  <span className="text-main-view-fg/60">Added</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-main-view-fg flex items-center gap-1 cursor-help">
                        <ClockIcon className="w-3 h-3" />
                        {formatTimestamp(sourceInfo.added_at)}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">
                        Document indexed: {formatTimestamp(sourceInfo.added_at)}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              )}

              {queryTimestamp && (
                <div className="flex justify-between items-center">
                  <span className="text-main-view-fg/60">Query Time</span>
                  <span className="text-main-view-fg flex items-center gap-1">
                    <ClockIcon className="w-3 h-3" />
                    {formatTimestamp(queryTimestamp)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default SourceCitation
