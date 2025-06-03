import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import {
  SearchIcon,
  RefreshCwIcon,
  FilterIcon,
  FileTextIcon,
  AlertCircleIcon,
  SortAscIcon,
  SortDescIcon,
  CalendarIcon,
  HardDriveIcon,
  LayersIcon,
  XIcon
} from 'lucide-react'

import { useRAGDocuments } from '../../hooks/useRAG'
import { useRAGDocumentOperations } from '../../hooks/useRAGDocumentOperations'
import { useRAGDocumentFilters } from '../../hooks/useRAGDocumentFilters'
import DocumentItem from './DocumentItem'

const DocumentList = () => {
  const { documents: ragDocuments, documentsLoading: loading } = useRAGDocuments()
  const { loadDocuments, deleteDocument } = useRAGDocumentOperations()
  const {
    searchTerm,
    filterStatus,
    sortBy,
    sortDirection,
    filteredAndSortedDocuments,
    stats,
    hasActiveFilters,
    setSearchTerm,
    setFilterStatus,
    handleSort,
    clearSearch,
    clearAllFilters
  } = useRAGDocumentFilters({ documents: ragDocuments })

  useEffect(() => {
    loadDocuments()
  }, [loadDocuments])

  const handleDeleteDocument = async (sourceId: string) => {
    await deleteDocument(sourceId)
  }


  return (
    <div className="p-6 space-y-6 h-full flex flex-col">
      {/* Header with Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary shadow-sm">
            <FileTextIcon className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-main-view-fg">Document Management</h2>
            <p className="text-sm text-main-view-fg/60">
              {ragDocuments.length} documents indexed
            </p>
          </div>
        </div>
        
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              onClick={loadDocuments}
              disabled={loading}
              variant="link"
              size="sm"
              className="hover:bg-main-view-fg/5 border border-main-view-fg/20 bg-main-view"
            >
              <RefreshCwIcon className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              {loading ? 'Loading...' : 'Refresh'}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Refresh document list</p>
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Enhanced Search and Filters */}
      <div className="space-y-4">
        {/* Search Bar */}
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <SearchIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-main-view-fg/40" />
            <Input
              placeholder="Search documents by name or path..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-10 bg-main-view-fg/5 border-main-view-fg/20 focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
              aria-label="Search documents"
            />
            {searchTerm && (
              <Button
                variant="link"
                size="sm"
                onClick={clearSearch}
                className="absolute right-2 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0 hover:bg-main-view-fg/10 rounded-full"
              >
                <XIcon className="w-3 h-3" />
              </Button>
            )}
          </div>
          
          {/* Sort Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="link"
                size="sm"
                className="border border-main-view-fg/20 bg-main-view hover:bg-main-view-fg/5 px-3"
              >
                {sortDirection === 'asc' ? <SortAscIcon className="w-4 h-4 mr-2" /> : <SortDescIcon className="w-4 h-4 mr-2" />}
                Sort by {sortBy}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleSort('name')}>
                <FileTextIcon className="w-4 h-4 mr-2" />
                Name
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleSort('date')}>
                <CalendarIcon className="w-4 h-4 mr-2" />
                Date
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleSort('size')}>
                <HardDriveIcon className="w-4 h-4 mr-2" />
                Size
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleSort('chunks')}>
                <LayersIcon className="w-4 h-4 mr-2" />
                Chunks
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        
        {/* Filter Tabs */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-main-view-fg/60">
            <FilterIcon className="w-4 h-4" />
            <span className="hidden sm:inline">Filter:</span>
          </div>
          <div className="flex gap-2 flex-wrap">
            {Object.entries(stats.statusCounts).map(([status, count]) => (
              <Button
                key={status}
                variant={filterStatus === status ? 'default' : 'link'}
                size="sm"
                onClick={() => setFilterStatus(status)}
                className={`capitalize transition-all duration-200 ${
                  filterStatus === status
                    ? 'bg-primary text-primary-fg shadow-sm border-0'
                    : 'hover:bg-main-view-fg/5 border-main-view-fg/20 bg-main-view text-main-view-fg'
                }`}
                aria-pressed={filterStatus === status}
              >
                {status === 'all' ? 'All' : status}
                <Badge
                  variant="secondary"
                  className={`ml-2 text-xs ${
                    filterStatus === status ? 'bg-primary-fg/20 text-primary-fg' : 'bg-main-view-fg/10'
                  }`}
                >
                  {count}
                </Badge>
              </Button>
            ))}
          </div>
        </div>
        
        {/* Active Filters Indicator */}
        {hasActiveFilters && (
          <div className="flex items-center gap-2 text-sm text-main-view-fg/70">
            <span>Active filters:</span>
            {searchTerm && (
              <Badge variant="secondary" className="bg-primary/10 text-primary">
                Search: "{searchTerm}"
              </Badge>
            )}
            {filterStatus !== 'all' && (
              <Badge variant="secondary" className="bg-primary/10 text-primary">
                Status: {filterStatus}
              </Badge>
            )}
            <Button
              variant="link"
              size="sm"
              onClick={clearAllFilters}
              className="text-xs text-main-view-fg/60 hover:text-main-view-fg h-6 px-2"
            >
              Clear all
            </Button>
          </div>
        )}
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 space-y-4">
            <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
            <div className="text-main-view-fg/70 font-medium">Loading documents...</div>
            <div className="text-sm text-main-view-fg/50">Please wait while we fetch your documents</div>
          </div>
        ) : filteredAndSortedDocuments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-8">
            <div className="relative">
              <div className="w-32 h-32 rounded-full bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center border-2 border-primary/20">
                {ragDocuments.length === 0 ? (
                  <FileTextIcon className="w-16 h-16 text-primary/60" />
                ) : (
                  <AlertCircleIcon className="w-16 h-16 text-primary/60" />
                )}
              </div>
              {ragDocuments.length === 0 && (
                <div className="absolute -top-2 -right-2 w-8 h-8 bg-primary rounded-full flex items-center justify-center">
                  <span className="text-white text-lg">+</span>
                </div>
              )}
            </div>
            
            <div className="text-center space-y-4 max-w-lg">
              <div className="text-2xl font-bold text-main-view-fg">
                {ragDocuments.length === 0 ? 'Start Building Your Knowledge Base' : 'No Documents Match Your Criteria'}
              </div>
              <div className="text-main-view-fg/70 text-lg leading-relaxed">
                {ragDocuments.length === 0
                  ? "Upload documents to create a personalized AI assistant that can answer questions based on your content."
                  : "Try adjusting your search terms or filter criteria to find what you're looking for."
                }
              </div>
              
              {ragDocuments.length === 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 max-w-md mx-auto">
                  <div className="text-center p-3 bg-main-view-fg/5 rounded-lg">
                    <FileTextIcon className="w-8 h-8 text-red-500 mx-auto mb-2" />
                    <span className="text-xs text-main-view-fg/70">PDFs</span>
                  </div>
                  <div className="text-center p-3 bg-main-view-fg/5 rounded-lg">
                    <FileTextIcon className="w-8 h-8 text-blue-500 mx-auto mb-2" />
                    <span className="text-xs text-main-view-fg/70">Documents</span>
                  </div>
                  <div className="text-center p-3 bg-main-view-fg/5 rounded-lg">
                    <FileTextIcon className="w-8 h-8 text-green-500 mx-auto mb-2" />
                    <span className="text-xs text-main-view-fg/70">Text Files</span>
                  </div>
                  <div className="text-center p-3 bg-main-view-fg/5 rounded-lg">
                    <FileTextIcon className="w-8 h-8 text-orange-500 mx-auto mb-2" />
                    <span className="text-xs text-main-view-fg/70">Data Files</span>
                  </div>
                </div>
              )}
            </div>
            
            <div className="flex flex-col sm:flex-row gap-3">
              {ragDocuments.length === 0 ? (
                <>
                  <Button
                    onClick={() => window.dispatchEvent(new CustomEvent('open-upload-dialog'))}
                    size="lg"
                    className="bg-primary hover:bg-primary/90 text-primary-fg shadow-lg hover:shadow-xl transition-all duration-200"
                  >
                    <FileTextIcon className="w-5 h-5 mr-2" />
                    Upload Your First Document
                  </Button>
                </>
              ) : (
                <Button
                  onClick={() => {
                    setSearchTerm('')
                    setFilterStatus('all')
                  }}
                  variant="link"
                  className="border border-main-view-fg/20 bg-main-view hover:bg-main-view-fg/5"
                >
                  Clear All Filters
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4 overflow-y-auto h-full">
            {filteredAndSortedDocuments.map((document) => (
              <DocumentItem
                key={document.source_id}
                document={document}
                onDelete={handleDeleteDocument}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer Stats */}
      {ragDocuments.length > 0 && (
        <div className="border-t border-main-view-fg/10 pt-4 bg-main-view-fg/5 rounded-lg px-4 py-3">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center space-x-4 text-main-view-fg/70">
              <span className="flex items-center">
                <FileTextIcon className="w-4 h-4 mr-1" />
                <strong className="text-main-view-fg">{ragDocuments.length}</strong> documents
              </span>
              <span className="flex items-center">
                <span className="w-2 h-2 bg-primary rounded-full mr-2"></span>
                <strong className="text-main-view-fg">
                  {ragDocuments.reduce((sum, doc) => sum + (doc.chunk_count ?? 0), 0)}
                </strong> chunks indexed
              </span>
            </div>
            <div className="text-xs text-main-view-fg/50">
              Last updated: {new Date().toLocaleTimeString()}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default DocumentList