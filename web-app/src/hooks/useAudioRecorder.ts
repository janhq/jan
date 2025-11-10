import { useState, useRef, useCallback } from 'react'

export interface AudioRecordingState {
  isRecording: boolean
  isPaused: boolean
  recordingTime: number
  audioBlob: Blob | null
  error: string | null
}

export interface UseAudioRecorderReturn {
  state: AudioRecordingState
  startRecording: () => Promise<void>
  stopRecording: () => Promise<Blob | null>
  pauseRecording: () => void
  resumeRecording: () => void
  cancelRecording: () => void
}

/**
 * Hook to handle audio recording from user's microphone
 * Uses MediaRecorder API for cross-browser compatibility
 */
export const useAudioRecorder = (): UseAudioRecorderReturn => {
  const [state, setState] = useState<AudioRecordingState>({
    isRecording: false,
    isPaused: false,
    recordingTime: 0,
    audioBlob: null,
    error: null,
  })

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // Start recording
  const startRecording = useCallback(async () => {
    try {
      // Request microphone permission
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000, // Whisper prefers 16kHz
        }
      })

      streamRef.current = stream

      // Create MediaRecorder with appropriate MIME type
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 128000,
      })

      mediaRecorderRef.current = mediaRecorder
      chunksRef.current = []

      // Handle data available event
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }

      // Handle recording stop
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType })
        setState((prev) => ({ ...prev, audioBlob: blob, isRecording: false }))
      }

      // Start recording
      mediaRecorder.start(100) // Collect data every 100ms

      // Start timer
      timerRef.current = setInterval(() => {
        setState((prev) => ({
          ...prev,
          recordingTime: prev.recordingTime + 1,
        }))
      }, 1000)

      setState((prev) => ({
        ...prev,
        isRecording: true,
        isPaused: false,
        recordingTime: 0,
        error: null,
      }))
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to access microphone'
      setState((prev) => ({
        ...prev,
        error: errorMessage,
        isRecording: false,
      }))
      console.error('Error starting recording:', error)
    }
  }, [])

  // Stop recording
  const stopRecording = useCallback(async (): Promise<Blob | null> => {
    if (mediaRecorderRef.current && state.isRecording) {
      return new Promise((resolve) => {
        const mediaRecorder = mediaRecorderRef.current!

        mediaRecorder.onstop = () => {
          const mimeType = mediaRecorder.mimeType
          const blob = new Blob(chunksRef.current, { type: mimeType })

          // Stop timer
          if (timerRef.current) {
            clearInterval(timerRef.current)
            timerRef.current = null
          }

          // Stop all tracks
          if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop())
            streamRef.current = null
          }

          setState((prev) => ({
            ...prev,
            audioBlob: blob,
            isRecording: false,
            isPaused: false,
          }))

          resolve(blob)
        }

        mediaRecorder.stop()
      })
    }
    return null
  }, [state.isRecording])

  // Pause recording
  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current && state.isRecording && !state.isPaused) {
      mediaRecorderRef.current.pause()
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      setState((prev) => ({ ...prev, isPaused: true }))
    }
  }, [state.isRecording, state.isPaused])

  // Resume recording
  const resumeRecording = useCallback(() => {
    if (mediaRecorderRef.current && state.isRecording && state.isPaused) {
      mediaRecorderRef.current.resume()

      // Restart timer
      timerRef.current = setInterval(() => {
        setState((prev) => ({
          ...prev,
          recordingTime: prev.recordingTime + 1,
        }))
      }, 1000)

      setState((prev) => ({ ...prev, isPaused: false }))
    }
  }, [state.isRecording, state.isPaused])

  // Cancel recording
  const cancelRecording = useCallback(() => {
    if (mediaRecorderRef.current && state.isRecording) {
      mediaRecorderRef.current.stop()

      // Stop timer
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }

      // Stop all tracks
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
        streamRef.current = null
      }

      chunksRef.current = []
      setState({
        isRecording: false,
        isPaused: false,
        recordingTime: 0,
        audioBlob: null,
        error: null,
      })
    }
  }, [state.isRecording])

  return {
    state,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    cancelRecording,
  }
}
