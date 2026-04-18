import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'

export interface LocalGgufModel {
  id: string
  name: string
  size: number
  path: string
  family?: string
  params?: number
  quantization?: string
}

function detectFamily(name: string): string {
  if (!name) return 'Other'
  const lower = name.toLowerCase()
  if (lower.includes('qwen')) return 'Qwen'
  if (lower.includes('llama')) return 'Llama'
  if (lower.includes('gemma')) return 'Gemma'
  if (lower.includes('mistral')) return 'Mistral'
  if (lower.includes('embed')) return 'Embedding'
  if (lower.includes('deepseek')) return 'DeepSeek'
  if (lower.includes('phi')) return 'Phi'
  return name.charAt(0).toUpperCase() + name.slice(1)
}

function extractParams(name: string): number | undefined {
  const match = name.match(/(\d+(?:\.\d+)?)\s?[bB]\b/)
  if (match) {
    return parseFloat(match[1])
  }
  return undefined
}

function extractQuantization(name: string): string | undefined {
  const lower = name.toLowerCase()
  const quants = [
    'q2_k',
    'q3_k',
    'q3_k_s',
    'q3_k_m',
    'q3_k_l',
    'q4_k',
    'q4_k_m',
    'q4_k_s',
    'q4_0',
    'q4_1',
    'q5_k',
    'q5_k_m',
    'q5_k_s',
    'q5_0',
    'q5_1',
    'q6_k',
    'q8_0',
    'fp16',
    'fp32',
  ]
  for (const q of quants) {
    if (lower.includes(q)) return q.toUpperCase()
  }
  const match = name.match(/[Qq](\d+)_?([KkMm]?)_?(?:[LlMmSs])?/)
  if (match) {
    return `Q${match[1]}${match[2]?.toUpperCase() || ''}`
  }
  return undefined
}

export function useLocalGgufModels() {
  const [models, setModels] = useState<LocalGgufModel[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const scanPath = useCallback(async (basePath: string) => {
    const result: LocalGgufModel[] = []
    const dirExists = await invoke<boolean>('exists_sync', { args: [basePath] })
    if (!dirExists) return result

    const entries = await invoke<string[]>('readdir_sync', {
      args: [basePath],
    })

    for (const entryPath of entries) {
      const ymlPath = await invoke<string>('join_path', {
        args: [entryPath, 'model.yml'],
      })

      const ymlExists = await invoke<boolean>('exists_sync', { args: [ymlPath] })
      if (!ymlExists) continue

      try {
        const yaml = await invoke<Record<string, unknown>>('read_yaml', {
          path: ymlPath,
        })
        const entryName = entryPath.replace(/\\/g, '/').split('/').pop() || ''
        const name =
          (yaml.name as string) || (yaml.id as string) || entryName
        const size = (yaml.size_bytes as number) || 0

        result.push({
          id: (yaml.id as string) || entryName,
          name,
          size,
          path: entryPath,
          family: detectFamily(name),
          params: extractParams(name),
          quantization: extractQuantization(name),
        })
      } catch (e) {
        console.warn(`Failed to read model.yml in ${entryPath}:`, e)
      }
    }

    return result
  }, [])

  const scan = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const janDataPath = await invoke<string>('get_jan_data_folder_path')
      const defaultPath = await invoke<string>('join_path', {
        args: [janDataPath, 'llamacpp', 'models'],
      })

      const allModels: LocalGgufModel[] = []

      // Scan default path
      const defaultModels = await scanPath(defaultPath)
      allModels.push(...defaultModels)

      // Scan custom paths
      const customPaths = await invoke<string[]>('get_gguf_scan_paths')
      for (const customPath of customPaths) {
        const customModels = await scanPath(customPath)
        allModels.push(...customModels)
      }

      setModels(allModels)
    } catch (err) {
      console.error('Failed to scan local GGUF models:', err)
      setError(err instanceof Error ? err.message : String(err))
      setModels([])
    } finally {
      setLoading(false)
    }
  }, [scanPath])

  useEffect(() => {
    scan()
  }, [scan])

  return { models, loading, error, refresh: scan }
}
