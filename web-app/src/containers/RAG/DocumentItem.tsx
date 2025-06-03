import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Progress } from '@/components/ui/progress'
import {
  TrashIcon,
  InfoIcon,
  FileTextIcon,
  HardDriveIcon,
  LayersIcon,
  CheckCircleIcon,
  AlertCircleIcon,
  ClockIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  MoreHorizontalIcon
} from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

import { RAGDocument } from '@/types/rag'
import { getFileIcon, getStatusColor } from '@/lib/rag-utils'
import { formatFileSize, formatDate } from '@/lib/format-utils'

interface DocumentItemProps {
  document: RAGDocument
  onDelete: (sourceId: string) => Promise<void>
}

const DocumentItem = ({ document, onDelete }: DocumentItemProps) => {
  const [isDeleting, setIsDeleting] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  const handleDelete = async () => {
    setIsDeleting(true)
    setDeleteDialogOpen(false)
    try {
      await onDelete(document.source_id)
    } catch (error) {
      console.error('Failed to delete document:', error)
    } finally {
      setIsDeleting(false)
    }
  }


  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'indexed':
        return <CheckCircleIcon className="w-3 h-3" />
      case 'processing':
        return <ClockIcon className="w-3 h-3 animate-pulse" />
      case 'error':
        return <AlertCircleIcon className="w-3 h-3" />
      default:
        return null
    }
  }

  return (
    <div className="bg-main-view border border-main-view-fg/10 rounded-xl p-5 group hover:shadow-lg hover:shadow-primary/5 transition-all duration-300 hover:border-primary/20">
      <div className="flex items-start gap-4">
        {/* Enhanced File Icon */}
        <div className="relative flex-shrink-0">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center text-2xl shadow-sm border border-primary/10">
            {getFileIcon(document.file_type)}
          </div>
          {/* Prominent Status Indicator */}
          <div className="absolute -top-2 -right-2">
            <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(document.status)}`}>
              {getStatusIcon(document.status)}
              <span className="capitalize">{document.status}</span>
            </div>
          </div>
        </div>
        
        {/* Main Content */}
        <div className="flex-1 min-w-0">
          {/* Header with improved hierarchy */}
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-semibold text-main-view-fg truncate mb-1">
                {document.filename}
              </h3>
              <Tooltip>
                <TooltipTrigger asChild>
                  <p className="text-sm text-main-view-fg/60 truncate cursor-help">
                    {document.path}
                  </p>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs break-all">{document.path}</p>
                </TooltipContent>
              </Tooltip>
            </div>
            
            {/* Actions Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="link"
                  size="sm"
                  className="opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8 p-0 hover:bg-main-view-fg/10 rounded-md"
                >
                  <MoreHorizontalIcon className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setShowDetails(!showDetails)}>
                  <InfoIcon className="w-4 h-4 mr-2" />
                  {showDetails ? 'Hide Details' : 'View Details'}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setDeleteDialogOpen(true)}
                  className="text-destructive focus:text-destructive"
                >
                  <TrashIcon className="w-4 h-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          
          {/* Key Metrics - Simplified */}
          <div className="flex items-center gap-6 text-sm text-main-view-fg/70 mb-3">
            <div className="flex items-center gap-1.5">
              <FileTextIcon className="w-4 h-4" />
              <span className="font-medium">{document.file_type.toUpperCase()}</span>
            </div>
            
            {document.chunk_count && (
              <div className="flex items-center gap-1.5">
                <LayersIcon className="w-4 h-4" />
                <span>{document.chunk_count} chunks</span>
              </div>
            )}
            
            <div className="flex items-center gap-1.5">
              <HardDriveIcon className="w-4 h-4" />
              <span>{formatFileSize(document.file_size)}</span>
            </div>
          </div>
          
          {/* Error Message - More prominent */}
          {document.status === 'error' && document.error_message && (
            <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertCircleIcon className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-red-800">Processing Failed</p>
                  <p className="text-xs text-red-700 mt-1">{document.error_message}</p>
                </div>
              </div>
            </div>
          )}
          
          {/* Processing Progress - Enhanced */}
          {document.status === 'processing' && (
            <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-amber-800">Processing document...</span>
                <ClockIcon className="w-4 h-4 text-amber-600 animate-pulse" />
              </div>
              <Progress value={undefined} className="h-2" />
            </div>
          )}
          
          {/* Details Toggle */}
          <Button
            variant="link"
            size="sm"
            onClick={() => setShowDetails(!showDetails)}
            className="h-8 px-2 text-xs text-main-view-fg/60 hover:text-main-view-fg transition-colors hover:bg-main-view-fg/5 rounded-md"
          >
            {showDetails ? (
              <>
                <ChevronDownIcon className="w-3 h-3 mr-1" />
                Hide Details
              </>
            ) : (
              <>
                <ChevronRightIcon className="w-3 h-3 mr-1" />
                Show Details
              </>
            )}
          </Button>
        </div>
      </div>
      
      {/* Collapsible Details Section */}
      {showDetails && (
        <div className="mt-5 pt-5 border-t border-main-view-fg/10 animate-in slide-in-from-top-2 duration-200">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Document Information */}
            <div className="space-y-4">
              <h4 className="font-semibold text-main-view-fg flex items-center text-sm">
                <InfoIcon className="w-4 h-4 mr-2 text-primary" />
                Document Information
              </h4>
              <div className="space-y-3 text-sm bg-main-view-fg/5 rounded-lg p-4">
                <div className="flex justify-between items-center">
                  <span className="text-main-view-fg/60">Source ID</span>
                  <span className="font-mono text-xs bg-main-view-fg/10 px-2 py-1 rounded border">
                    {document.source_id.slice(0, 8)}...
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-main-view-fg/60">Created</span>
                  <span className="text-main-view-fg">{formatDate(document.created_at)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-main-view-fg/60">Updated</span>
                  <span className="text-main-view-fg">{formatDate(document.updated_at)}</span>
                </div>
              </div>
            </div>
            
            {/* Metadata */}
            {document.metadata && Object.keys(document.metadata).length > 0 && (
              <div className="space-y-4">
                <h4 className="font-semibold text-main-view-fg flex items-center text-sm">
                  <LayersIcon className="w-4 h-4 mr-2 text-primary" />
                  Metadata
                </h4>
                <div className="space-y-3 text-sm bg-main-view-fg/5 rounded-lg p-4">
                  {Object.entries(document.metadata).map(([key, value]) => (
                    <div key={key} className="flex justify-between items-center">
                      <span className="text-main-view-fg/60 capitalize">
                        {key.replace(/_/g, ' ')}
                      </span>
                      <span className="text-main-view-fg text-right max-w-xs truncate">
                        {String(value)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Document</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{document.filename}"? This action cannot be undone and will remove all associated chunks from your knowledge base.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="link"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={isDeleting}
              className="border border-main-view-fg/20 bg-main-view hover:bg-main-view-fg/5"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete Document'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default DocumentItem