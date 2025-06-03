import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { PlusIcon, FileTextIcon, DatabaseIcon } from 'lucide-react'
import DocumentList from '@/containers/RAG/DocumentList'
import DocumentUpload from '@/containers/RAG/DocumentUpload'

export const Route = createFileRoute('/rag-documents')({
  component: RAGDocuments,
})

function RAGDocuments() {
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false)

  const handleUploadComplete = useCallback(() => {
    setUploadDialogOpen(false)
  }, [])

  useEffect(() => {
    const handleOpenUploadDialog = () => {
      setUploadDialogOpen(true)
    }

    window.addEventListener('open-upload-dialog', handleOpenUploadDialog)

    return () => {
      window.removeEventListener('open-upload-dialog', handleOpenUploadDialog)
    }
  }, [])

  return (
    <div className="flex flex-col h-full bg-main-view">
      {/* Header */}
      <div className="border-b border-main-view-fg/10 bg-main-view">
        <div className="flex items-center justify-between p-6">
          <div className="flex items-center space-x-4">
            <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-primary text-primary-fg shadow-sm">
              <DatabaseIcon className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-main-view-fg">
                RAG Documents
              </h1>
              <p className="text-sm text-main-view-fg/70 mt-1 flex items-center space-x-2">
                <FileTextIcon className="w-4 h-4" />
                <span>
                  Manage your knowledge base for enhanced AI responses
                </span>
              </p>
            </div>
          </div>

          <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
            <DialogTrigger asChild>
              <Button
                size="lg"
                className="bg-primary hover:bg-primary/90 text-primary-fg shadow-sm hover:shadow-md transition-all duration-200"
              >
                <PlusIcon className="w-5 h-5 mr-2" />
                Add Documents
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden">
              <DocumentUpload
                onUploadComplete={handleUploadComplete}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        <DocumentList />
      </div>
    </div>
  )
}
