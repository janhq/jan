/**
 * Service to interact with Whisper ASR Webservice API for audio transcription
 * Compatible with ahmetoner/whisper-asr-webservice
 */

import { invoke } from '@tauri-apps/api/core'

export interface WhisperConfig {
  apiUrl: string
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
 * Uses Tauri backend command to bypass browser CORS restrictions
 * @param audioBlob - Audio file to transcribe
 * @param config - Whisper API configuration
 * @returns Transcribed text
 */
export async function transcribeAudio(
  audioBlob: Blob,
  config: WhisperConfig
): Promise<TranscriptionResponse> {
  try {
    // Convert Blob to Uint8Array for Tauri backend
    const arrayBuffer = await audioBlob.arrayBuffer()
    const audioData = Array.from(new Uint8Array(arrayBuffer))

    // Debug: Log audio information
    console.log('[Whisper Debug] Audio Blob info:', {
      size: audioBlob.size,
      type: audioBlob.type,
      arrayBufferSize: arrayBuffer.byteLength,
      audioDataLength: audioData.length,
    })

    // Build query parameters object for /asr endpoint
    const queryParams: Record<string, string> = {}

    // Add optional parameters
    if (config.task) {
      queryParams.task = config.task
    } else {
      queryParams.task = 'transcribe' // Default to transcribe
    }

    if (config.language && config.language !== 'auto') {
      queryParams.language = config.language
    }

    if (config.output) {
      queryParams.output = config.output
    } else {
      queryParams.output = 'txt' // Default to plain text
    }

    // Enable encoding by default (recommended)
    queryParams.encode = String(config.encode ?? true)

    // Add VAD filter if specified
    if (config.vadFilter) {
      queryParams.vad_filter = 'true'
    }

    // Add word timestamps if specified
    if (config.wordTimestamps) {
      queryParams.word_timestamps = 'true'
    }

    console.log('[Whisper] Using Tauri backend to bypass CORS')
    console.log('[Whisper] Making request to:', config.apiUrl)
    console.log('[Whisper] Query params:', queryParams)

    // Use Tauri backend command to bypass CORS
    const response = await invoke<{
      status: number
      body: string
      headers: Record<string, string>
    }>('http_post_multipart', {
      url: config.apiUrl,
      queryParams,
      audioData,
      audioFilename: 'recording.webm',
      fieldName: 'audio_file',
      headers: null,
    })

    console.log('[Whisper Debug] Response received:', {
      status: response.status,
      bodyLength: response.body.length,
      body: response.body,
      headers: response.headers,
    })

    if (response.status !== 200) {
      let errorMessage = `API request failed with status ${response.status}`
      try {
        const errorData = JSON.parse(response.body)
        errorMessage =
          errorData.detail?.[0]?.msg ||
          errorData.message ||
          errorMessage
      } catch {
        // If body is not JSON, use status message
      }
      throw new Error(errorMessage)
    }

    // Handle response based on output format
    const contentType = response.headers['content-type'] || ''

    if (contentType.includes('application/json')) {
      const data = JSON.parse(response.body)
      // JSON format includes detailed information
      return {
        text: data.text || '',
        language: data.language,
        duration: data.duration,
      }
    } else {
      // Plain text format (default)
      return {
        text: response.body.trim(),
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
