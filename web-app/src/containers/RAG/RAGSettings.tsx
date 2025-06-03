import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { useRAGConfig, type EmbeddingConfig, type ChunkingConfig } from '@/hooks/useRAGConfig'

const RAGSettings = () => {
  const { documents: ragDocuments } = useRAGDocuments()
  const { clearAllDocuments, operationLoading } = useRAGDocumentOperations()
  const { stats } = useRAGDocumentFilters({ documents: ragDocuments })
  const [clearDialogOpen, setClearDialogOpen] = useState(false)
  
  // Use RAG configuration hook
  const {
    embeddingConfig,
    chunkingConfig,
    embeddingLoading,
    chunkingLoading,
    loadConfigurations,
    updateEmbeddingConfig,
    updateChunkingConfig,
  } = useRAGConfig()

  // Local state for form inputs
  const [localEmbeddingConfig, setLocalEmbeddingConfig] = useState<EmbeddingConfig>({
    base_url: 'http://localhost:6333',
    api_key: '',
    model: 'text-embedding-3-small',
    dimensions: 1536,
    batch_size: 10
  })
  
  const [localChunkingConfig, setLocalChunkingConfig] = useState<ChunkingConfig>({
    chunk_size: 1000,
    overlap: 100
  })

  // Load configurations on mount and update local state when configs change
  useEffect(() => {
    loadConfigurations()
  }, [loadConfigurations])

  useEffect(() => {
    if (embeddingConfig) {
      setLocalEmbeddingConfig(embeddingConfig)
    }
  }, [embeddingConfig])

  useEffect(() => {
    if (chunkingConfig) {
      setLocalChunkingConfig(chunkingConfig)
    }
  }, [chunkingConfig])

  const handleUpdateEmbeddingConfig = async () => {
    await updateEmbeddingConfig(localEmbeddingConfig)
  }

  const handleUpdateChunkingConfig = async () => {
    await updateChunkingConfig(localChunkingConfig)
  }

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

      {/* Embedding Configuration */}
      <Card>
        <h3 className="text-lg font-semibold mb-4">Embedding Configuration</h3>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Base URL</label>
              <Input
                value={localEmbeddingConfig.base_url}
                onChange={(e) => setLocalEmbeddingConfig(prev => ({ ...prev, base_url: e.target.value }))}
                placeholder="http://localhost:6333"
                className="bg-main-view border-main-view-fg/10"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">API Key (Optional)</label>
              <Input
                type="password"
                value={localEmbeddingConfig.api_key || ''}
                onChange={(e) => setLocalEmbeddingConfig(prev => ({ ...prev, api_key: e.target.value }))}
                placeholder="Your API key"
                className="bg-main-view border-main-view-fg/10"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Model</label>
              <Input
                value={localEmbeddingConfig.model}
                onChange={(e) => setLocalEmbeddingConfig(prev => ({ ...prev, model: e.target.value }))}
                placeholder="text-embedding-3-small"
                className="bg-main-view border-main-view-fg/10"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Dimensions</label>
              <Input
                type="number"
                value={localEmbeddingConfig.dimensions}
                onChange={(e) => setLocalEmbeddingConfig(prev => ({ ...prev, dimensions: parseInt(e.target.value) || 1536 }))}
                className="bg-main-view border-main-view-fg/10"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Batch Size</label>
              <Input
                type="number"
                value={localEmbeddingConfig.batch_size}
                onChange={(e) => setLocalEmbeddingConfig(prev => ({ ...prev, batch_size: parseInt(e.target.value) || 10 }))}
                className="bg-main-view border-main-view-fg/10"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              onClick={handleUpdateEmbeddingConfig}
              disabled={embeddingLoading}
              size="sm"
            >
              {embeddingLoading ? 'Updating...' : 'Update Embedding Config'}
            </Button>
          </div>
        </div>
      </Card>

      {/* Chunking Configuration */}
      <Card>
        <h3 className="text-lg font-semibold mb-4">Text Chunking Configuration</h3>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Chunk Size</label>
              <Input
                type="number"
                value={localChunkingConfig.chunk_size}
                onChange={(e) => setLocalChunkingConfig(prev => ({ ...prev, chunk_size: parseInt(e.target.value) || 1000 }))}
                className="bg-main-view border-main-view-fg/10"
              />
              <p className="text-xs text-main-view-fg/60">Maximum number of characters per chunk</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Overlap</label>
              <Input
                type="number"
                value={localChunkingConfig.overlap}
                onChange={(e) => setLocalChunkingConfig(prev => ({ ...prev, overlap: parseInt(e.target.value) || 100 }))}
                className="bg-main-view border-main-view-fg/10"
              />
              <p className="text-xs text-main-view-fg/60">Number of overlapping characters between chunks</p>
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              onClick={handleUpdateChunkingConfig}
              disabled={chunkingLoading}
              size="sm"
            >
              {chunkingLoading ? 'Updating...' : 'Update Chunking Config'}
            </Button>
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
