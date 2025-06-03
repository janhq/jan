/**
 * Custom hook for RAG document filtering and sorting
 */

import { useState, useMemo, useCallback } from 'react'
import { RAGDocument, SortOption, SortDirection } from '@/types/rag'
import { filterDocuments, sortDocuments, getDocumentStats } from '@/lib/rag-utils'

interface UseRAGDocumentFiltersProps {
  documents: RAGDocument[]
}

export const useRAGDocumentFilters = ({ documents }: UseRAGDocumentFiltersProps) => {
  const [searchTerm, setSearchTerm] = useState('')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [sortBy, setSortBy] = useState<SortOption>('date')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')

  /**
   * Filtered and sorted documents based on current filters
   */
  const filteredAndSortedDocuments = useMemo(() => {
    const filtered = filterDocuments(documents, searchTerm, filterStatus)
    return sortDocuments(filtered, sortBy, sortDirection)
  }, [documents, searchTerm, filterStatus, sortBy, sortDirection])

  /**
   * Document statistics
   */
  const stats = useMemo(() => getDocumentStats(documents), [documents])

  /**
   * Handle sorting with direction toggle
   */
  const handleSort = useCallback((option: SortOption) => {
    if (sortBy === option) {
      setSortDirection(current => current === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(option)
      setSortDirection('asc')
    }
  }, [sortBy])

  /**
   * Clear search term
   */
  const clearSearch = useCallback(() => {
    setSearchTerm('')
  }, [])

  /**
   * Clear all filters
   */
  const clearAllFilters = useCallback(() => {
    setSearchTerm('')
    setFilterStatus('all')
  }, [])

  /**
   * Check if any filters are active
   */
  const hasActiveFilters = useMemo(() => {
    return searchTerm !== '' || filterStatus !== 'all'
  }, [searchTerm, filterStatus])

  /**
   * Reset filters to default
   */
  const resetFilters = useCallback(() => {
    setSearchTerm('')
    setFilterStatus('all')
    setSortBy('date')
    setSortDirection('desc')
  }, [])

  return {
    // State
    searchTerm,
    filterStatus,
    sortBy,
    sortDirection,
    
    // Computed
    filteredAndSortedDocuments,
    stats,
    hasActiveFilters,
    
    // Actions
    setSearchTerm,
    setFilterStatus,
    handleSort,
    clearSearch,
    clearAllFilters,
    resetFilters
  }
}