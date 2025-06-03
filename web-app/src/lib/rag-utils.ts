/**
 * RAG-specific utility functions
 */

import { RAGDocument, RAGDocumentStatus, MCPSource, FILE_TYPE_ICONS, STATUS_CONFIG } from '@/types/rag'
import { getFileTypeFromName, getFileNameFromPath } from '@/lib/format-utils'

/**
 * File utilities
 */
export const getFileIcon = (fileType: string): string => {
  return FILE_TYPE_ICONS[fileType.toLowerCase()] ?? FILE_TYPE_ICONS.pdf
}

/**
 * Status utilities
 */
export const getStatusColor = (status: RAGDocumentStatus): string => {
  return STATUS_CONFIG[status]?.color ?? STATUS_CONFIG.error.color
}

export const getStatusIcon = (status: RAGDocumentStatus): string => {
  return STATUS_CONFIG[status]?.icon ?? STATUS_CONFIG.error.icon
}

/**
 * Document validation
 */
export const isValidFileType = (fileName: string): boolean => {
  const extension = fileName.toLowerCase().split('.').pop()
  if (!extension) return false
  
  const supportedExtensions = ['pdf', 'txt', 'md', 'docx', 'html', 'csv', 'json']
  return supportedExtensions.includes(extension)
}

/**
 * Data transformation utilities
 */
export const transformMCPSourceToRAGDocument = (source: MCPSource): RAGDocument => {
  return {
    source_id: source.source_id,
    path: source.path ?? source.path_or_url ?? '',
    filename: source.filename ?? source.path?.split('/').pop() ?? 'Unknown',
    file_type: source.file_type ?? getFileTypeFromName(source.filename ?? ''),
    status: source.status ?? 'indexed',
    created_at: source.created_at ?? new Date().toISOString(),
    updated_at: source.updated_at ?? new Date().toISOString(),
    metadata: source.metadata ?? {},
    chunk_count: source.chunk_count,
    file_size: source.file_size,
    error_message: source.error_message
  }
}

export const transformMCPSources = (sources: MCPSource[]): RAGDocument[] => {
  return sources.map(transformMCPSourceToRAGDocument)
}

/**
 * Search and filtering utilities
 */
export const filterDocuments = (
  documents: RAGDocument[],
  searchTerm: string,
  statusFilter: string
): RAGDocument[] => {
  return documents.filter(doc => {
    const matchesSearch = !searchTerm || 
      doc.filename.toLowerCase().includes(searchTerm.toLowerCase()) ||
      doc.path.toLowerCase().includes(searchTerm.toLowerCase())
    
    const matchesFilter = statusFilter === 'all' || doc.status === statusFilter
    
    return matchesSearch && matchesFilter
  })
}

export const sortDocuments = (
  documents: RAGDocument[],
  sortBy: string,
  sortDirection: 'asc' | 'desc'
): RAGDocument[] => {
  return [...documents].sort((a, b) => {
    let comparison = 0
    
    switch (sortBy) {
      case 'name':
        comparison = a.filename.localeCompare(b.filename)
        break
      case 'date':
        comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        break
      case 'size':
        comparison = (a.file_size ?? 0) - (b.file_size ?? 0)
        break
      case 'chunks':
        comparison = (a.chunk_count ?? 0) - (b.chunk_count ?? 0)
        break
      default:
        return 0
    }
    
    return sortDirection === 'asc' ? comparison : -comparison
  })
}

/**
 * Statistics utilities
 */
export const getDocumentStats = (documents: RAGDocument[]) => {
  const statusCounts = documents.reduce((acc, doc) => {
    acc[doc.status] = (acc[doc.status] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  const totalChunks = documents.reduce((sum, doc) => sum + (doc.chunk_count ?? 0), 0)
  const totalSize = documents.reduce((sum, doc) => sum + (doc.file_size ?? 0), 0)
  const indexedDocuments = documents.filter(doc => doc.status === 'indexed')

  return {
    total: documents.length,
    statusCounts: {
      all: documents.length,
      ...statusCounts
    },
    totalChunks,
    totalSize,
    indexedCount: indexedDocuments.length,
    indexedChunks: indexedDocuments.reduce((sum, doc) => sum + (doc.chunk_count ?? 0), 0)
  }
}

/**
 * File upload utilities
 */
export const createFileMetadata = (file: File) => ({
  original_filename: file.name,
  file_size: file.size,
  upload_date: new Date().toISOString(),
  file_type: getFileTypeFromName(file.name)
})

export const createFileMetadataFromPath = (filePath: string) => {
  const fileName = getFileNameFromPath(filePath)
  return {
    original_filename: fileName,
    file_size: 0, // Size not available from path
    upload_date: new Date().toISOString(),
    file_type: getFileTypeFromName(fileName)
  }
}