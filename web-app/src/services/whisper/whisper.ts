/**
 * Service to interact with Whisper API for audio transcription
 * Configurable to work with custom Whisper endpoints
 */

export interface WhisperConfig {
  apiUrl: string
  apiKey?: string
  model?: string
  language?: string
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
 * Transcribe audio using Whisper API
 * @param audioBlob - Audio file to transcribe
 * @param config - Whisper API configuration
 * @returns Transcribed text
 */
export async function transcribeAudio(
  audioBlob: Blob,
  config: WhisperConfig
): Promise<TranscriptionResponse> {
  try {
    // Convert WebM to format suitable for Whisper if needed
    const formData = new FormData()

    // Create a File object from Blob with proper extension
    const audioFile = new File([audioBlob], 'recording.webm', {
      type: audioBlob.type || 'audio/webm',
    })

    formData.append('file', audioFile)

    // Add optional parameters
    if (config.model) {
      formData.append('model', config.model)
    }

    if (config.language) {
      formData.append('language', config.language)
    }

    // Configure headers
    const headers: HeadersInit = {}
    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`
    }

    // Make API request
    const response = await fetch(config.apiUrl, {
      method: 'POST',
      headers,
      body: formData,
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(
        errorData.message || `API request failed with status ${response.status}`
      )
    }

    const data = await response.json()

    // Handle different response formats
    // Standard Whisper API format: { text: "transcription" }
    // Custom format might be different - adjust as needed
    return {
      text: data.text || data.transcription || '',
      language: data.language,
      duration: data.duration,
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
    apiUrl: 'https://whisper.contextcompany.com.co/v1/audio/transcriptions',
    apiKey: '', // Users need to set their API key
    model: 'whisper-1', // Default model
    language: 'auto', // Auto-detect language
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
  targetFormat: string
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
