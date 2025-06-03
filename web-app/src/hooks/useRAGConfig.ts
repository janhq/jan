import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { toast } from 'sonner'

interface EmbeddingConfig {
  base_url: string
  api_key?: string
  model: string
  dimensions: number
  batch_size: number
}

interface ChunkingConfig {
  chunk_size: number
  overlap: number
}

interface UpdateResponse {
  status: string
  message?: string
}

interface RAGConfigState {
  embeddingConfig: EmbeddingConfig | null
  chunkingConfig: ChunkingConfig | null
  embeddingLoading: boolean
  chunkingLoading: boolean
  error: string | null

  // Actions
  setEmbeddingConfig: (config: EmbeddingConfig | null) => void
  setChunkingConfig: (config: ChunkingConfig | null) => void
  setEmbeddingLoading: (loading: boolean) => void
  setChunkingLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  loadEmbeddingConfig: () => Promise<EmbeddingConfig>
  updateEmbeddingConfig: (config: EmbeddingConfig) => Promise<UpdateResponse>
  loadChunkingConfig: () => Promise<ChunkingConfig>
  updateChunkingConfig: (config: ChunkingConfig) => Promise<UpdateResponse>
  loadConfigurations: () => Promise<void>
}

export const useRAGConfigStore = create<RAGConfigState>()(
  persist(
    (set, get) => ({
      // Initial state
      embeddingConfig: null,
      chunkingConfig: null,
      embeddingLoading: false,
      chunkingLoading: false,
      error: null,

      // Basic setters
      setEmbeddingConfig: (config) => set({ embeddingConfig: config }),
      setChunkingConfig: (config) => set({ chunkingConfig: config }),
      setEmbeddingLoading: (loading) => set({ embeddingLoading: loading }),
      setChunkingLoading: (loading) => set({ chunkingLoading: loading }),
      setError: (error) => set({ error }),

      // Load embedding config
      loadEmbeddingConfig: async () => {
        set({ embeddingLoading: true, error: null })
        try {
          const result = await window.core?.api?.getRagEmbeddingConfig()
          const parsed = typeof result === 'string' ? JSON.parse(result) : result
          const config = parsed.embedding_config
          set({
            embeddingConfig: config,
            embeddingLoading: false
          })
          return config
        } catch (error) {
          const errorMessage = 'Failed to load embedding configuration'
          set({
            error: errorMessage,
            embeddingLoading: false
          })
          toast.error(errorMessage)
          throw error
        }
      },

      // Update embedding config
      updateEmbeddingConfig: async (config: EmbeddingConfig) => {
        set({ embeddingLoading: true, error: null })
        try {
          const result = await window.core?.api?.updateRagEmbeddingConfig({
            embeddingConfig: config
          })
          const parsed = typeof result === 'string' ? JSON.parse(result) : result
          
          if (parsed.status === 'success') {
            set({
              embeddingConfig: config,
              embeddingLoading: false
            })
            toast.success('Embedding configuration updated successfully')
            return parsed
          } else {
            throw new Error(parsed.message || 'Update failed')
          }
        } catch (error) {
          const errorMessage = 'Failed to update embedding configuration'
          set({
            error: errorMessage,
            embeddingLoading: false
          })
          toast.error(errorMessage)
          throw error
        }
      },

      // Load chunking config
      loadChunkingConfig: async () => {
        set({ chunkingLoading: true, error: null })
        try {
          const result = await window.core?.api?.getRagChunkingConfig()
          const parsed = typeof result === 'string' ? JSON.parse(result) : result
          const config = parsed.chunking_config
          set({
            chunkingConfig: config,
            chunkingLoading: false
          })
          return config
        } catch (error) {
          const errorMessage = 'Failed to load chunking configuration'
          set({
            error: errorMessage,
            chunkingLoading: false
          })
          toast.error(errorMessage)
          throw error
        }
      },

      // Update chunking config
      updateChunkingConfig: async (config: ChunkingConfig) => {
        set({ chunkingLoading: true, error: null })
        try {
          const result = await window.core?.api?.updateRagChunkingConfig({
            chunkingConfig: config
          })
          const parsed = typeof result === 'string' ? JSON.parse(result) : result
          
          if (parsed.status === 'success') {
            set({
              chunkingConfig: config,
              chunkingLoading: false
            })
            toast.success('Chunking configuration updated successfully')
            return parsed
          } else {
            throw new Error(parsed.message || 'Update failed')
          }
        } catch (error) {
          const errorMessage = 'Failed to update chunking configuration'
          set({
            error: errorMessage,
            chunkingLoading: false
          })
          toast.error(errorMessage)
          throw error
        }
      },

      // Load all configurations
      loadConfigurations: async () => {
        try {
          const { loadEmbeddingConfig, loadChunkingConfig } = get()
          await Promise.all([
            loadEmbeddingConfig(),
            loadChunkingConfig()
          ])
        } catch (error) {
          console.error('Failed to load RAG configurations:', error)
        }
      },
    }),
    {
      name: 'jan-rag-config',
      storage: createJSONStorage(() => localStorage),
      // Only persist configuration data, not loading states
      partialize: (state) => ({
        embeddingConfig: state.embeddingConfig,
        chunkingConfig: state.chunkingConfig,
      })
    }
  )
)

// Export convenience hooks
export const useRAGConfig = () => {
  const {
    embeddingConfig,
    chunkingConfig,
    embeddingLoading,
    chunkingLoading,
    error,
    loadEmbeddingConfig,
    updateEmbeddingConfig,
    loadChunkingConfig,
    updateChunkingConfig,
    loadConfigurations,
  } = useRAGConfigStore()

  return {
    embeddingConfig,
    chunkingConfig,
    embeddingLoading,
    chunkingLoading,
    error,
    loadEmbeddingConfig,
    updateEmbeddingConfig,
    loadChunkingConfig,
    updateChunkingConfig,
    loadConfigurations,
  }
}

export const useEmbeddingConfig = () => {
  const {
    embeddingConfig,
    embeddingLoading,
    loadEmbeddingConfig,
    updateEmbeddingConfig,
  } = useRAGConfigStore()

  return {
    embeddingConfig,
    embeddingLoading,
    loadEmbeddingConfig,
    updateEmbeddingConfig,
  }
}

export const useChunkingConfig = () => {
  const {
    chunkingConfig,
    chunkingLoading,
    loadChunkingConfig,
    updateChunkingConfig,
  } = useRAGConfigStore()

  return {
    chunkingConfig,
    chunkingLoading,
    loadChunkingConfig,
    updateChunkingConfig,
  }
}

export type { EmbeddingConfig, ChunkingConfig }