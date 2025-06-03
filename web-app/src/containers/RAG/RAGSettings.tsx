import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/containers/Card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useRAGDocuments } from '@/hooks/useRAG'
import { useRAGDocumentOperations } from '@/hooks/useRAGDocumentOperations'
import { useRAGDocumentFilters } from '@/hooks/useRAGDocumentFilters'

const RAGSettings = () => {
  const { documents: ragDocuments } = useRAGDocuments()
  const { clearAllDocuments, operationLoading } = useRAGDocumentOperations()
  const { stats } = useRAGDocumentFilters({ documents: ragDocuments })
  const [clearDialogOpen, setClearDialogOpen] = useState(false)

  const handleClearAllData = async () => {
    setClearDialogOpen(false)
    await clearAllDocuments()
  }

  return (
    <div className="p-6 space-y-6">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-main-view-fg">
          RAG Configuration
        </h2>
        <p className="text-main-view-fg/70 text-sm">
          Configure RAG settings and manage your knowledge base for enhanced AI
          responses.
        </p>
      </div>

      {/* Document Stats */}
      <Card>
        <h4 className="font-medium mb-3">Knowledge Base</h4>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="flex justify-between">
            <span>Documents:</span>
            <span className="font-mono">{stats.indexedCount}</span>
          </div>
          <div className="flex justify-between">
            <span>Chunks:</span>
            <span className="font-mono">{stats.indexedChunks}</span>
          </div>
        </div>
      </Card>

      {/* System Actions */}
      <Card>
        <h3 className="text-lg font-semibold mb-4">System Actions</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-medium">Clear All Data</h4>
              <p className="text-sm text-main-view-fg/60">
                Remove all documents and embeddings
              </p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setClearDialogOpen(true)}
              disabled={operationLoading}
            >
              {operationLoading ? 'Clearing...' : 'Clear'}
            </Button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-medium">Rebuild Index</h4>
              <p className="text-sm text-main-view-fg/60">
                Rebuild vector index for all documents
              </p>
            </div>
            <Button variant="default" size="sm" disabled>
              Rebuild
            </Button>
          </div>
        </div>
      </Card>

      {/* Clear Confirmation Dialog */}
      <Dialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear All RAG Data</DialogTitle>
            <DialogDescription>
              This will permanently delete all indexed documents, embeddings,
              and chunks. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="link"
              onClick={() => setClearDialogOpen(false)}
              disabled={operationLoading}
              className="border border-main-view-fg/20 bg-main-view hover:bg-main-view-fg/5"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleClearAllData}
              disabled={operationLoading}
            >
              {operationLoading ? 'Clearing...' : 'Clear All Data'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default RAGSettings
