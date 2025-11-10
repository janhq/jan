import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import HeaderPage from '@/containers/HeaderPage'
import SettingsMenu from '@/containers/SettingsMenu'
import { Card, CardItem } from '@/containers/Card'
import { useState, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import {
  getDefaultWhisperConfig,
  saveWhisperConfig,
  WhisperConfig,
  transcribeAudio,
} from '@/services/whisper/whisper'
import { IconCheck, IconLoader2, IconMicrophone } from '@tabler/icons-react'
import { useAudioRecorder } from '@/hooks/useAudioRecorder'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.whisper as any)({
  component: WhisperSettings,
})

function WhisperSettings() {
  const [config, setConfig] = useState<WhisperConfig>({
    apiUrl: '',
    apiKey: '',
    model: '',
    language: '',
  })
  const [isSaving, setIsSaving] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)

  const { startRecording, stopRecording, state: recorderState } = useAudioRecorder()

  // Load saved configuration
  useEffect(() => {
    const savedConfig = getDefaultWhisperConfig()
    setConfig(savedConfig)
  }, [])

  // Handle input changes
  const handleChange = (field: keyof WhisperConfig, value: string) => {
    setConfig((prev) => ({ ...prev, [field]: value }))
  }

  // Save configuration
  const handleSave = async () => {
    try {
      setIsSaving(true)

      // Validate required fields
      if (!config.apiUrl) {
        toast.error('API URL is required')
        return
      }

      if (!config.apiKey) {
        toast.error('API Key is required')
        return
      }

      // Save to localStorage
      saveWhisperConfig(config)

      toast.success('Whisper configuration saved successfully!')
    } catch (error) {
      console.error('Failed to save configuration:', error)
      toast.error('Failed to save configuration')
    } finally {
      setIsSaving(false)
    }
  }

  // Test configuration
  const handleTest = async () => {
    try {
      setIsTesting(true)

      if (!config.apiUrl || !config.apiKey) {
        toast.error('Please configure API URL and API Key first')
        return
      }

      // Start recording
      toast.info('Recording audio... Click again to stop', { id: 'test-recording' })
      await startRecording()

      // Wait for user to stop
      // Note: This is a simplified test flow
    } catch (error) {
      console.error('Test failed:', error)
      toast.error('Test failed', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      setIsTesting(false)
    }
  }

  // Handle test recording stop
  useEffect(() => {
    const handleTestTranscription = async () => {
      if (isTesting && !recorderState.isRecording && recorderState.audioBlob) {
        try {
          toast.loading('Testing transcription...', { id: 'test-transcription' })

          const result = await transcribeAudio(recorderState.audioBlob, config)

          toast.success('Test successful!', {
            id: 'test-transcription',
            description: `Transcribed: "${result.text.substring(0, 100)}..."`,
          })
        } catch (error) {
          toast.error('Test failed', {
            id: 'test-transcription',
            description: error instanceof Error ? error.message : 'Unknown error',
          })
        }
      }
    }

    handleTestTranscription()
  }, [recorderState.isRecording, recorderState.audioBlob, isTesting, config])

  return (
    <div className="h-full flex flex-col w-full overflow-hidden">
      <div className="flex flex-col h-full overflow-hidden">
        <HeaderPage
          title="Whisper Settings"
          description="Configure your Whisper API for voice input transcription"
        />

        <div className="flex flex-row h-full w-full overflow-hidden">
          <SettingsMenu />

          <div className="flex-1 overflow-y-auto">
            <div className="py-8 px-12 space-y-6">
              {/* Info Card */}
              <Card>
                <div className="p-4 bg-accent/5 border border-accent/20 rounded-lg">
                  <div className="flex items-start space-x-3">
                    <IconMicrophone size={20} className="text-accent mt-0.5" />
                    <div className="flex-1">
                      <h4 className="font-semibold text-main-view-fg mb-1">
                        Voice Input with Whisper
                      </h4>
                      <p className="text-sm text-main-view-fg/70">
                        Connect your Whisper API to enable voice input in Jan. Record audio
                        and get instant transcriptions directly in your chat.
                      </p>
                    </div>
                  </div>
                </div>
              </Card>

              {/* API Configuration */}
              <Card>
                <CardItem title="API Configuration" separator={false}>
                  <div className="space-y-4 mt-4">
                    {/* API URL */}
                    <div className="space-y-2">
                      <Label htmlFor="apiUrl">
                        API URL <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="apiUrl"
                        type="url"
                        placeholder="https://whisper.contextcompany.com.co/v1/audio/transcriptions"
                        value={config.apiUrl}
                        onChange={(e) => handleChange('apiUrl', e.target.value)}
                      />
                      <p className="text-xs text-main-view-fg/50">
                        The endpoint URL for your Whisper API
                      </p>
                    </div>

                    {/* API Key */}
                    <div className="space-y-2">
                      <Label htmlFor="apiKey">
                        API Key <span className="text-destructive">*</span>
                      </Label>
                      <div className="relative">
                        <Input
                          id="apiKey"
                          type={showApiKey ? 'text' : 'password'}
                          placeholder="Enter your API key"
                          value={config.apiKey}
                          onChange={(e) => handleChange('apiKey', e.target.value)}
                          className="pr-20"
                        />
                        <button
                          type="button"
                          onClick={() => setShowApiKey(!showApiKey)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-main-view-fg/50 hover:text-main-view-fg"
                        >
                          {showApiKey ? 'Hide' : 'Show'}
                        </button>
                      </div>
                      <p className="text-xs text-main-view-fg/50">
                        Your authentication key for the Whisper API
                      </p>
                    </div>

                    {/* Model Name */}
                    <div className="space-y-2">
                      <Label htmlFor="model">Model Name (Optional)</Label>
                      <Input
                        id="model"
                        type="text"
                        placeholder="whisper-1"
                        value={config.model}
                        onChange={(e) => handleChange('model', e.target.value)}
                      />
                      <p className="text-xs text-main-view-fg/50">
                        The Whisper model to use (e.g., whisper-1, whisper-large-v3)
                      </p>
                    </div>

                    {/* Language */}
                    <div className="space-y-2">
                      <Label htmlFor="language">Language (Optional)</Label>
                      <Input
                        id="language"
                        type="text"
                        placeholder="auto"
                        value={config.language}
                        onChange={(e) => handleChange('language', e.target.value)}
                      />
                      <p className="text-xs text-main-view-fg/50">
                        The language of the audio (e.g., en, es, fr). Leave as 'auto' for
                        automatic detection
                      </p>
                    </div>
                  </div>
                </CardItem>
              </Card>

              {/* Actions */}
              <div className="flex items-center gap-3">
                <Button
                  onClick={handleSave}
                  disabled={isSaving || !config.apiUrl || !config.apiKey}
                  className="min-w-[120px]"
                >
                  {isSaving ? (
                    <>
                      <IconLoader2 size={16} className="animate-spin mr-2" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <IconCheck size={16} className="mr-2" />
                      Save
                    </>
                  )}
                </Button>

                <Button
                  onClick={handleTest}
                  variant="outline"
                  disabled={isTesting || !config.apiUrl || !config.apiKey}
                  className="min-w-[120px]"
                >
                  {isTesting ? (
                    <>
                      <IconLoader2 size={16} className="animate-spin mr-2" />
                      {recorderState.isRecording ? 'Recording...' : 'Testing...'}
                    </>
                  ) : (
                    <>
                      <IconMicrophone size={16} className="mr-2" />
                      Test Connection
                    </>
                  )}
                </Button>
              </div>

              {/* Usage Instructions */}
              <Card>
                <CardItem title="How to Use" separator={false}>
                  <div className="space-y-3 mt-4 text-sm text-main-view-fg/70">
                    <div className="flex items-start space-x-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent/20 text-accent flex items-center justify-center text-xs font-semibold">
                        1
                      </span>
                      <p>
                        Click the microphone button in the chat input to start recording
                      </p>
                    </div>
                    <div className="flex items-start space-x-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent/20 text-accent flex items-center justify-center text-xs font-semibold">
                        2
                      </span>
                      <p>Speak your message clearly</p>
                    </div>
                    <div className="flex items-start space-x-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent/20 text-accent flex items-center justify-center text-xs font-semibold">
                        3
                      </span>
                      <p>
                        Click the check button to stop and transcribe, or X to cancel
                      </p>
                    </div>
                    <div className="flex items-start space-x-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent/20 text-accent flex items-center justify-center text-xs font-semibold">
                        4
                      </span>
                      <p>
                        The transcribed text will be added to your message automatically
                      </p>
                    </div>
                  </div>
                </CardItem>
              </Card>

              {/* API Information */}
              <Card>
                <CardItem title="API Information" separator={false}>
                  <div className="space-y-2 mt-4 text-sm text-main-view-fg/70">
                    <p>
                      <strong>Your Whisper API:</strong>{' '}
                      <a
                        href="https://whisper.contextcompany.com.co/docs"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent hover:underline"
                      >
                        https://whisper.contextcompany.com.co/docs
                      </a>
                    </p>
                    <p>
                      <strong>Standard format:</strong> Compatible with OpenAI Whisper API
                    </p>
                    <p>
                      <strong>Supported formats:</strong> WebM, MP3, WAV, M4A (check your
                      API documentation)
                    </p>
                  </div>
                </CardItem>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
