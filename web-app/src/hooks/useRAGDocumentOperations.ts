/**
 * Custom hook for RAG document operations (CRUD operations)
 */

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { listRAGSources, removeRAGSource, addFileToRAG, cleanAllRAGSources } from '@/services/rag'
import { transformMCPSources } from '@/lib/rag-utils'
import { getErrorMessage } from '@/lib/format-utils'
import { useRAGDocuments } from './useRAG'
import { RAGDocument } from '@/types/rag'

export const useRAGDocumentOperations = () => {
  const { setDocuments, setDocumentsLoading, removeDocument } = useRAGDocuments()
  const [operationLoading, setOperationLoading] = useState(false)

  /**
   * Load all documents from the RAG system
   */
  const loadDocuments = useCallback(async (): Promise<RAGDocument[]> => {
    setDocumentsLoading(true)
    try {
      const { sources } = await listRAGSources()
      const documents = transformMCPSources(sources)
      setDocuments(documents)
      return documents
    } catch (error) {
      const message = getErrorMessage(error)
      console.error('Failed to load RAG documents:', error)
      toast.error(`Failed to load documents: ${message}`)
      return []
    } finally {
      setDocumentsLoading(false)
    }
  }, [setDocuments, setDocumentsLoading])

  /**
   * Delete a specific document
   */
  const deleteDocument = useCallback(async (sourceId: string): Promise<void> => {
    setOperationLoading(true)
    try {
      await removeRAGSource(sourceId)
      removeDocument(sourceId)
      toast.success('Document deleted successfully')
    } catch (error) {
      const message = getErrorMessage(error)
      console.error('Failed to delete document:', error)
      toast.error(`Failed to delete document: ${message}`)
      throw error
    } finally {
      setOperationLoading(false)
    }
  }, [removeDocument])

  /**
   * Add a file to the RAG system
   */
  const addDocument = useCallback(async (
    filePath: string,
    metadata: Record<string, unknown> = {}
  ): Promise<{ status: string; source_id: string; message: string; chunk_count: number }> => {
    setOperationLoading(true)
    try {
      const result = await addFileToRAG(filePath, metadata)
      toast.success(`File "${metadata.original_filename ?? 'Unknown'}" uploaded and indexed successfully`)
      return result
    } catch (error) {
      const message = getErrorMessage(error)
      console.error('Failed to add file to RAG:', error)
      toast.error(`Failed to process file: ${message}`)
      throw error
    } finally {
      setOperationLoading(false)
    }
  }, [])

  /**
   * Clear all documents from the RAG system
   */
  const clearAllDocuments = useCallback(async (): Promise<void> => {
    setOperationLoading(true)
    try {
      const result = await cleanAllRAGSources()
      toast.success(
        `Successfully cleared ${result.sources_removed} documents and ${result.chunks_removed} chunks`
      )
      // Reload the page to refresh all state
      setTimeout(() => window.location.reload(), 1500)
    } catch (error) {
      const message = getErrorMessage(error)
      console.error('Failed to clear RAG data:', error)
      toast.error(`Failed to clear RAG data: ${message}`)
      throw error
    } finally {
      setOperationLoading(false)
    }
  }, [])

  return {
    loadDocuments,
    deleteDocument,
    addDocument,
    clearAllDocuments,
    operationLoading
  }
}