/**
 * Service to interact with Whisper ASR Webservice API for audio transcription
 * Compatible with ahmetoner/whisper-asr-webservice
 */

import { fetch as fetchTauri } from '@tauri-apps/plugin-http'

export interface WhisperConfig {
  apiUrl: string
  apiKey?: string
  task?: 'transcribe' | 'translate'
  language?: string
  output?: 'txt' | 'vtt' | 'srt' | 'tsv' | 'json'
  encode?: boolean
  vadFilter?: boolean
  wordTimestamps?: boolean
}

export interface TranscriptionResponse {
  text: string
  language?: string
  duration?: number
}

export interface TranscriptionError {
  error: string
  message: string
}

/**
 * Transcribe audio using Whisper ASR Webservice API
 * @param audioBlob - Audio file to transcribe
 * @param config - Whisper API configuration
 * @returns Transcribed text
 */
export async function transcribeAudio(
  audioBlob: Blob,
  config: WhisperConfig
): Promise<TranscriptionResponse> {
  try {
    // Use Tauri's native HTTP when available to bypass browser CORS
    const doFetch: typeof fetch =
      typeof (window as any).__TAURI__ !== 'undefined'
        ? (fetchTauri as unknown as typeof fetch)
        : fetch
    // Create FormData with audio file
    const formData = new FormData()

    // Create a File object from Blob - use 'audio_file' as the field name
    const audioFile = new File([audioBlob], 'recording.webm', {
      type: audioBlob.type || 'audio/webm',
    })

    formData.append('audio_file', audioFile)

    // Build query parameters for /asr endpoint
    const params = new URLSearchParams()

    // Add optional parameters
    if (config.task) {
      params.append('task', config.task)
    } else {
      params.append('task', 'transcribe') // Default to transcribe
    }

    if (config.language && config.language !== 'auto') {
      params.append('language', config.language)
    }

    if (config.output) {
      params.append('output', config.output)
    } else {
      params.append('output', 'txt') // Default to plain text
    }

    // Enable encoding by default (recommended)
    params.append('encode', String(config.encode ?? true))

    // Add VAD filter if specified
    if (config.vadFilter) {
      params.append('vad_filter', 'true')
    }

    // Add word timestamps if specified
    if (config.wordTimestamps) {
      params.append('word_timestamps', 'true')
    }

    // Build full URL with query parameters
    const url = `${config.apiUrl}?${params.toString()}`

    // Make API request (no authentication headers required)
    const response = await doFetch(url, {
      method: 'POST',
      body: formData,
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(
        errorData.detail?.[0]?.msg ||
        errorData.message ||
        `API request failed with status ${response.status}`
      )
    }

    // Handle response based on output format
    const contentType = response.headers.get('content-type')

    if (contentType?.includes('application/json')) {
      const data = await response.json()
      // JSON format includes detailed information
      return {
        text: data.text || '',
        language: data.language,
        duration: data.duration,
      }
    } else {
      // Plain text format (default)
      const text = await response.text()
      return {
        text: text.trim(),
        language: config.language,
      }
    }
  } catch (error) {
    console.error('Transcription error:', error)
    throw error
  }
}

/**
 * Get default Whisper configuration
 * Users can override this with their own settings
 */
export function getDefaultWhisperConfig(): WhisperConfig {
  // Check if custom config exists in localStorage
  const savedConfig = localStorage.getItem('whisper-config')
  if (savedConfig) {
    try {
      return JSON.parse(savedConfig)
    } catch (e) {
      console.error('Failed to parse saved Whisper config:', e)
    }
  }

  // Default configuration - users should update this
  return {
    apiUrl: 'https://whisper.contextcompany.com.co/asr',
    apiKey: undefined,
    task: 'transcribe', // Default to transcription
    language: 'auto', // Auto-detect language
    output: 'txt', // Default to plain text
    encode: true, // Enable encoding (recommended)
    vadFilter: false, // Voice activity detection filter
    wordTimestamps: false, // Word-level timestamps
  }
}

/**
 * Save Whisper configuration to localStorage
 */
export function saveWhisperConfig(config: WhisperConfig): void {
  localStorage.setItem('whisper-config', JSON.stringify(config))
}

/**
 * Convert audio blob to different format if needed
 * Note: This is a placeholder - actual conversion might need a library
 */
export async function convertAudioFormat(
  blob: Blob,
  _targetFormat: string
): Promise<Blob> {
  // For now, return the blob as-is
  // In production, you might want to use a library like ffmpeg.js
  // to convert audio formats
  return blob
}

/**
 * Validate audio blob before sending to API
 */
export function validateAudioBlob(blob: Blob | null): boolean {
  if (!blob) {
    return false
  }

  // Check if blob has audio data
  if (blob.size === 0) {
    return false
  }

  // Optionally check file size (Whisper has 25MB limit)
  const maxSize = 25 * 1024 * 1024 // 25MB
  if (blob.size > maxSize) {
    console.warn('Audio file exceeds 25MB limit')
    return false
  }

  return true
}
