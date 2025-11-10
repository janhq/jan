import { useState, useEffect } from 'react'
import {
  IconMicrophone,
  IconPlayerStopFilled,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconX,
  IconCheck,
  IconLoader2,
} from '@tabler/icons-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useAudioRecorder } from '@/hooks/useAudioRecorder'
import {
  transcribeAudio,
  getDefaultWhisperConfig,
  validateAudioBlob,
} from '@/services/whisper/whisper'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface MicrophoneButtonProps {
  onTranscriptionComplete: (text: string) => void
  disabled?: boolean
  className?: string
}

export const MicrophoneButton = ({
  onTranscriptionComplete,
  disabled = false,
  className,
}: MicrophoneButtonProps) => {
  const {
    state,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    cancelRecording,
  } = useAudioRecorder()

  const [isTranscribing, setIsTranscribing] = useState(false)
  const [showRecordingDialog, setShowRecordingDialog] = useState(false)

  // Show recording dialog when recording starts
  useEffect(() => {
    setShowRecordingDialog(state.isRecording)
  }, [state.isRecording])

  // Handle microphone button click
  const handleMicrophoneClick = async () => {
    if (disabled) return

    if (!state.isRecording) {
      // Start recording
      await startRecording()
    } else {
      // Stop recording and transcribe
      await handleStopAndTranscribe()
    }
  }

  // Stop recording and transcribe
  const handleStopAndTranscribe = async () => {
    try {
      setIsTranscribing(true)

      const audioBlob = await stopRecording()

      if (!validateAudioBlob(audioBlob)) {
        toast.error('Invalid audio recording', {
          description: 'Please try recording again.',
        })
        return
      }

      // Get Whisper configuration
      const config = getDefaultWhisperConfig()

      if (!config.apiKey) {
        toast.error('Whisper API key not configured', {
          description: 'Please configure your Whisper API key in settings.',
        })
        return
      }

      // Transcribe audio
      toast.loading('Transcribing audio...', { id: 'transcription' })

      const result = await transcribeAudio(audioBlob!, config)

      toast.success('Transcription complete!', { id: 'transcription' })

      // Pass transcribed text to parent
      if (result.text) {
        onTranscriptionComplete(result.text)
      }
    } catch (error) {
      console.error('Transcription error:', error)
      toast.error('Failed to transcribe audio', {
        id: 'transcription',
        description:
          error instanceof Error ? error.message : 'Please try again.',
      })
    } finally {
      setIsTranscribing(false)
      setShowRecordingDialog(false)
    }
  }

  // Handle cancel
  const handleCancel = () => {
    cancelRecording()
    setShowRecordingDialog(false)
    toast.info('Recording cancelled')
  }

  // Format recording time
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <>
      {/* Microphone Button */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleMicrophoneClick}
              disabled={disabled || isTranscribing}
              className={cn(
                'h-7 p-1 flex items-center justify-center rounded-sm transition-all duration-200 ease-in-out gap-1',
                state.isRecording
                  ? 'bg-red-500/10 hover:bg-red-500/20'
                  : 'hover:bg-main-view-fg/10',
                disabled && 'opacity-50 cursor-not-allowed',
                className
              )}
            >
              {isTranscribing ? (
                <IconLoader2 size={18} className="animate-spin text-main-view-fg/50" />
              ) : state.isRecording ? (
                <IconPlayerStopFilled size={18} className="text-red-500" />
              ) : (
                <IconMicrophone size={18} className="text-main-view-fg/50" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p>
              {isTranscribing
                ? 'Transcribing...'
                : state.isRecording
                ? 'Stop recording'
                : 'Voice input'}
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Recording Dialog */}
      {showRecordingDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-window-background border border-main-view-fg/10 rounded-lg p-6 shadow-xl max-w-md w-full mx-4">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-main-view-fg">
                {isTranscribing ? 'Transcribing Audio...' : 'Recording'}
              </h3>
              <button
                onClick={handleCancel}
                disabled={isTranscribing}
                className="text-main-view-fg/50 hover:text-main-view-fg transition-colors"
              >
                <IconX size={20} />
              </button>
            </div>

            {/* Recording Indicator */}
            {!isTranscribing && (
              <div className="flex flex-col items-center space-y-4 mb-6">
                {/* Animated recording indicator */}
                <div className="relative">
                  <div className="w-20 h-20 rounded-full bg-red-500/20 flex items-center justify-center">
                    <div className="w-16 h-16 rounded-full bg-red-500/40 flex items-center justify-center animate-pulse">
                      <IconMicrophone size={32} className="text-red-500" />
                    </div>
                  </div>
                  {state.isPaused && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-full">
                      <IconPlayerPauseFilled size={24} className="text-white" />
                    </div>
                  )}
                </div>

                {/* Timer */}
                <div className="text-3xl font-mono font-bold text-main-view-fg">
                  {formatTime(state.recordingTime)}
                </div>

                {/* Status */}
                <div className="text-sm text-main-view-fg/70">
                  {state.isPaused ? 'Paused' : 'Recording...'}
                </div>
              </div>
            )}

            {/* Transcribing State */}
            {isTranscribing && (
              <div className="flex flex-col items-center space-y-4 mb-6">
                <IconLoader2 size={48} className="animate-spin text-accent" />
                <div className="text-sm text-main-view-fg/70">
                  Processing audio...
                </div>
              </div>
            )}

            {/* Controls */}
            {!isTranscribing && (
              <div className="flex items-center justify-center space-x-3">
                {/* Pause/Resume */}
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={state.isPaused ? resumeRecording : pauseRecording}
                        className="w-12 h-12 rounded-full bg-main-view-fg/10 hover:bg-main-view-fg/20 flex items-center justify-center transition-colors"
                      >
                        {state.isPaused ? (
                          <IconPlayerPlayFilled size={20} className="text-main-view-fg" />
                        ) : (
                          <IconPlayerPauseFilled size={20} className="text-main-view-fg" />
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{state.isPaused ? 'Resume' : 'Pause'}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                {/* Stop and Transcribe */}
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={handleStopAndTranscribe}
                        className="w-14 h-14 rounded-full bg-accent hover:bg-accent/90 flex items-center justify-center transition-colors"
                      >
                        <IconCheck size={24} className="text-white" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Stop and transcribe</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                {/* Cancel */}
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={handleCancel}
                        className="w-12 h-12 rounded-full bg-destructive/10 hover:bg-destructive/20 flex items-center justify-center transition-colors"
                      >
                        <IconX size={20} className="text-destructive" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Cancel</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            )}

            {/* Error message */}
            {state.error && (
              <div className="mt-4 p-3 bg-destructive/10 text-destructive text-sm rounded">
                {state.error}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
