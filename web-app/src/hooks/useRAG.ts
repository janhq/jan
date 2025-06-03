import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { RAGDocument } from '@/types/rag'

interface RAGState {
  documents: RAGDocument[]
  documentsLoading: boolean

  // Selected RAG setting screen
  selectedSetting: string

  setDocuments: (documents: RAGDocument[]) => void
  setDocumentsLoading: (loading: boolean) => void
  addDocument: (document: RAGDocument) => void
  removeDocument: (sourceId: string) => void
  updateDocument: (sourceId: string, updates: Partial<RAGDocument>) => void
  cleanAllDocuments: () => void
  setSelectedSetting: (setting: string) => void
}

export const useRAG = create<RAGState>()(
  persist(
    (set) => ({
      // Initial state
      documents: [],
      documentsLoading: false,
      selectedSetting: 'dashboard',

      setDocuments: (documents: RAGDocument[]) => {
        set({ documents })
      },

      setDocumentsLoading: (loading: boolean) => {
        set({ documentsLoading: loading })
      },

      addDocument: (document: RAGDocument) => {
        set((state) => ({
          documents: [...state.documents, document]
        }))
      },

      removeDocument: (sourceId: string) => {
        set((state) => ({
          documents: state.documents.filter(doc => doc.source_id !== sourceId)
        }))
      },

      updateDocument: (sourceId: string, updates: Partial<RAGDocument>) => {
        set((state) => ({
          documents: state.documents.map(doc =>
            doc.source_id === sourceId ? { ...doc, ...updates } : doc
          )
        }))
      },

      cleanAllDocuments: () => {
        set({
          documents: [],
        })
      },

      setSelectedSetting: (setting: string) => {
        set({ selectedSetting: setting })
      }
    }),
    {
      name: 'jan-rag-settings',
      storage: createJSONStorage(() => localStorage),
      // Only persist certain parts of the state
      partialize: (state) => ({
        selectedSetting: state.selectedSetting
      })
    }
  )
)

export const useRAGDocuments = () => {
  const {
    documents,
    documentsLoading,
    setDocuments,
    setDocumentsLoading,
    addDocument,
    removeDocument,
    updateDocument,
    cleanAllDocuments
  } = useRAG()

  return {
    documents,
    documentsLoading,
    setDocuments,
    setDocumentsLoading,
    addDocument,
    removeDocument,
    updateDocument,
    cleanAllDocuments
  }
}


export const useRAGNavigation = () => {
  const { selectedSetting, setSelectedSetting } = useRAG()
  return { selectedSetting, setSelectedSetting }
}