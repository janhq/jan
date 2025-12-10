import { useState, useEffect } from 'react'
import { useAuth } from '@/stores/auth-store'

declare const JAN_API_BASE_URL: string

export interface Model {
  id: string
  object: string
  created: number
  owned_by: string
  model_display_name: string
  category: string
  category_order_number: number
  model_order_number: number
}

interface ModelsResponse {
  object: string
  data: Model[]
}

interface UseModelsReturn {
  models: Model[]
  loading: boolean
  error: Error | null
  refetch: () => void
}

export function useModels(): UseModelsReturn {
  const [models, setModels] = useState<Model[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const accessToken = useAuth((state) => state.accessToken)

  const fetchModels = async () => {
    if (!accessToken) {
      setError(new Error('No access token available'))
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      setError(null)
      const response = await fetch(`${JAN_API_BASE_URL}v1/models`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.statusText}`)
      }

      const data: ModelsResponse = await response.json()
      setModels(data.data)
    } catch (err) {
      setError(
        err instanceof Error ? err : new Error('An unknown error occurred')
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchModels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken])

  return {
    models,
    loading,
    error,
    refetch: fetchModels,
  }
}
