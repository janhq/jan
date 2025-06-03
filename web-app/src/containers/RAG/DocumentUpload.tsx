import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { IconUpload } from '@tabler/icons-react'
import {
  CloudUploadIcon,
  FileIcon,
  CheckCircleIcon,
  XCircleIcon,
  FileTextIcon,
  DatabaseIcon,
  CodeIcon,
  SparklesIcon,
} from 'lucide-react'
import { useRAGFileUpload } from '../../hooks/useRAGFileUpload'
import { getCurrentWebview } from '@tauri-apps/api/webview'

interface DocumentUploadProps {
  onUploadComplete?: () => void
}

const DocumentUpload = ({ onUploadComplete }: DocumentUploadProps) => {
  const {
    uploading,
    uploadProgress,
    uploadStatus,
    currentFileName,
    dragActive,
    fileInputRef,
    handleFileUpload,
    handleTauriFileDrop,
    triggerFileSelect,
    setDragActive
  } = useRAGFileUpload({ onUploadComplete })

  // Tauri-specific drag & drop handling
  useEffect(() => {
    let unlisten: (() => void) | null = null

    const setupTauriDragDrop = async () => {
      try {
        const webview = getCurrentWebview()
        
        unlisten = await webview.onDragDropEvent((event) => {
          if (event.payload.type === 'enter') {
            setDragActive(true)
          } else if (event.payload.type === 'over') {
            setDragActive(true)
          } else if (event.payload.type === 'drop') {
            const dropPayload = event.payload as { type: 'drop'; paths: string[] }
            setDragActive(false)
            
            if (dropPayload.paths && dropPayload.paths.length > 0) {
              handleTauriFileDrop(dropPayload.paths)
            }
          } else if (event.payload.type === 'leave') {
            setDragActive(false)
          }
        })
      } catch (error) {
        console.error('Failed to setup Tauri drag & drop:', error)
      }
    }

    setupTauriDragDrop()

    return () => {
      if (unlisten) {
        unlisten()
      }
    }
  }, [handleTauriFileDrop, setDragActive])


  return (
    <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="flex items-center justify-center space-x-3">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-primary shadow-sm">
            <CloudUploadIcon className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-main-view-fg">
              Upload Documents
            </h2>
            <p className="text-sm text-main-view-fg/70">
              Add documents to your RAG knowledge base
            </p>
          </div>
        </div>
      </div>

      {/* Enhanced Upload Area */}
      <div
        className={`relative border-2 border-dashed rounded-2xl p-8 text-center transition-all duration-300 ${
          dragActive
            ? 'border-primary bg-gradient-to-br from-primary/10 to-primary/5 scale-[1.02] shadow-xl ring-4 ring-primary/20'
            : 'border-main-view-fg/20 hover:border-primary/40 hover:bg-gradient-to-br hover:from-primary/5 hover:to-transparent'
        } ${uploading ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}
        onClick={(e) => {
          e.stopPropagation()
          triggerFileSelect()
        }}
        role="button"
        tabIndex={0}
        aria-label="Upload documents by clicking or dragging files here"
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !uploading) {
            e.preventDefault()
            e.stopPropagation()
            triggerFileSelect()
          }
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".pdf,.txt,.md,.docx,.html,.csv,.json"
          onChange={handleFileUpload}
          disabled={uploading}
        />

        <div className="space-y-6">
          {/* Enhanced Upload Icon with Status */}
          <div className="mx-auto w-24 h-24 rounded-full flex items-center justify-center relative">
            {uploadStatus === 'idle' && (
              <div className="w-full h-full bg-gradient-to-br from-primary/20 to-primary/10 rounded-full flex items-center justify-center border-2 border-primary/20">
                <CloudUploadIcon size={40} className="text-primary" />
              </div>
            )}
            {uploadStatus === 'uploading' && (
              <div className="w-full h-full bg-gradient-to-br from-accent/20 to-accent/10 rounded-full flex items-center justify-center border-2 border-accent/20 animate-pulse">
                <FileIcon size={40} className="text-accent" />
              </div>
            )}
            {uploadStatus === 'success' && (
              <div className="w-full h-full bg-gradient-to-br from-emerald-100 to-emerald-50 rounded-full flex items-center justify-center border-2 border-emerald-200">
                <CheckCircleIcon size={40} className="text-emerald-600" />
              </div>
            )}
            {uploadStatus === 'error' && (
              <div className="w-full h-full bg-gradient-to-br from-red-100 to-red-50 rounded-full flex items-center justify-center border-2 border-red-200">
                <XCircleIcon size={40} className="text-red-600" />
              </div>
            )}
          </div>

          {/* Enhanced Status Text */}
          <div className="space-y-3">
            <h3 className="text-xl font-semibold text-main-view-fg">
              {uploadStatus === 'idle' && 'Drop files here or click to upload'}
              {uploadStatus === 'uploading' &&
                `Processing ${currentFileName}...`}
              {uploadStatus === 'success' && 'Upload completed successfully!'}
              {uploadStatus === 'error' && 'Upload failed'}
            </h3>

            {uploadStatus === 'idle' && (
              <div className="space-y-4">
                <p className="text-sm text-main-view-fg/70">
                  Drag and drop your documents or click to browse
                </p>

                {/* File Format Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-md mx-auto">
                  <div className="flex flex-col items-center p-3 bg-main-view-fg/5 rounded-lg border border-main-view-fg/10">
                    <FileTextIcon className="w-6 h-6 text-red-500 mb-1" />
                    <span className="text-xs font-medium text-main-view-fg/70">
                      PDF
                    </span>
                  </div>
                  <div className="flex flex-col items-center p-3 bg-main-view-fg/5 rounded-lg border border-main-view-fg/10">
                    <FileTextIcon className="w-6 h-6 text-blue-500 mb-1" />
                    <span className="text-xs font-medium text-main-view-fg/70">
                      DOCX
                    </span>
                  </div>
                  <div className="flex flex-col items-center p-3 bg-main-view-fg/5 rounded-lg border border-main-view-fg/10">
                    <CodeIcon className="w-6 h-6 text-green-500 mb-1" />
                    <span className="text-xs font-medium text-main-view-fg/70">
                      MD/TXT
                    </span>
                  </div>
                  <div className="flex flex-col items-center p-3 bg-main-view-fg/5 rounded-lg border border-main-view-fg/10">
                    <DatabaseIcon className="w-6 h-6 text-orange-500 mb-1" />
                    <span className="text-xs font-medium text-main-view-fg/70">
                      CSV/JSON
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-center gap-2">
                  <Badge
                    variant="secondary"
                    className="text-xs bg-main-view-fg/10"
                  >
                    Max 50MB
                  </Badge>
                  {/* <Badge
                    variant="secondary"
                    className="text-xs bg-main-view-fg/10"
                  >
                    Multiple files supported
                  </Badge> */}
                </div>
              </div>
            )}

            {uploadStatus === 'uploading' && (
              <div className="space-y-4">
                <div className="w-full max-w-sm mx-auto">
                  <div className="flex items-center justify-between text-sm mb-2">
                    <span className="text-main-view-fg/70">Progress</span>
                    <span className="font-medium text-main-view-fg">
                      {uploadProgress}%
                    </span>
                  </div>
                  <Progress
                    value={uploadProgress}
                    className="h-3 bg-main-view-fg/10"
                  />
                </div>
                <div className="bg-accent/10 border border-accent/20 rounded-lg p-3">
                  <p className="text-sm text-accent font-medium">
                    {uploadProgress < 50 && '📖 Reading file content...'}
                    {uploadProgress >= 50 &&
                      uploadProgress < 80 &&
                      '💾 Saving to local storage...'}
                    {uploadProgress >= 80 &&
                      '🧠 Processing for RAG indexing...'}
                  </p>
                </div>
              </div>
            )}

            {uploadStatus === 'success' && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                <div className="flex items-center justify-center gap-2 text-emerald-700">
                  <SparklesIcon className="w-5 h-5" />
                  <span className="font-medium">
                    Document successfully indexed!
                  </span>
                </div>
                <p className="text-sm text-emerald-600 mt-1">
                  Your document is now available for AI-enhanced conversations
                </p>
              </div>
            )}
          </div>

          {/* Action Button */}
          {uploadStatus === 'idle' && (
            <Button
              onClick={(e) => {
                e.stopPropagation()
                if (!uploading) {
                  triggerFileSelect()
                }
              }}
              disabled={uploading}
              size="lg"
              className="bg-primary hover:bg-primary/90 text-primary-fg shadow-lg hover:shadow-xl transition-all duration-200"
            >
              <IconUpload className="w-5 h-5 mr-2" />
              Choose Files
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

export default DocumentUpload
