import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import HeaderPage from '@/containers/HeaderPage'
import SettingsMenu from '@/containers/SettingsMenu'
import { Card, CardItem } from '@/containers/Card'
import { useState, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { toast } from 'sonner'
import {
  getDefaultWhisperConfig,
  saveWhisperConfig,
  WhisperConfig,
  transcribeAudio,
} from '@/services/whisper/whisper'
import { IconCheck, IconLoader2, IconMicrophone } from '@tabler/icons-react'
import { useAudioRecorder } from '@/hooks/useAudioRecorder'
import { useTranslation } from 'react-i18next'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.whisper as any)({
  component: WhisperSettings,
})

function WhisperSettings() {
  const { t } = useTranslation('whisper')
  const [config, setConfig] = useState<WhisperConfig>({
    apiUrl: '',
    task: 'transcribe',
    language: 'auto',
    output: 'txt',
    encode: true,
    vadFilter: false,
    wordTimestamps: false,
  })
  const [isSaving, setIsSaving] = useState(false)
  const [isTesting, setIsTesting] = useState(false)

  const { startRecording, state: recorderState } = useAudioRecorder()

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
        toast.error(t('apiConfiguration.apiUrl.required'))
        return
      }

      // Save to localStorage
      saveWhisperConfig(config)

      toast.success(t('messages.configSaved'))
    } catch (error) {
      console.error('Failed to save configuration:', error)
      toast.error(t('messages.configSaveFailed'))
    } finally {
      setIsSaving(false)
    }
  }

  // Test configuration
  const handleTest = async () => {
    try {
      setIsTesting(true)

      if (!config.apiUrl) {
        toast.error(t('messages.configureFirst'))
        return
      }

      // Start recording
      toast.info(t('messages.recordingInfo'), { id: 'test-recording' })
      await startRecording()

      // Wait for user to stop
      // Note: This is a simplified test flow
    } catch (error) {
      console.error('Test failed:', error)
      toast.error(t('messages.testFailed'), {
        description: error instanceof Error ? error.message : t('messages.unknownError'),
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
          toast.loading(t('messages.testingTranscription'), { id: 'test-transcription' })

          const result = await transcribeAudio(recorderState.audioBlob, config)

          toast.success(t('messages.testSuccess'), {
            id: 'test-transcription',
            description: `${t('messages.transcribedPrefix')}${result.text.substring(0, 100)}..."`,
          })
        } catch (error) {
          toast.error(t('messages.testFailed'), {
            id: 'test-transcription',
            description: error instanceof Error ? error.message : t('messages.unknownError'),
          })
        }
      }
    }

    handleTestTranscription()
  }, [recorderState.isRecording, recorderState.audioBlob, isTesting, config, t])

  return (
    <div className="h-full flex flex-col w-full overflow-hidden">
      <div className="flex flex-col h-full overflow-hidden">
        <HeaderPage>
          <div className="flex items-center gap-2">
            <h1 className="font-medium">{t('title')}</h1>
            <span className="text-sm text-main-view-fg/70">
              {t('subtitle')}
            </span>
          </div>
        </HeaderPage>

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
                        {t('infoCard.title')}
                      </h4>
                      <p className="text-sm text-main-view-fg/70">
                        {t('infoCard.description')}
                      </p>
                      <p className="text-sm text-accent mt-2">
                        {t('infoCard.noApiKeyRequired')}
                      </p>
                    </div>
                  </div>
                </div>
              </Card>

              {/* API Configuration */}
              <Card>
                <CardItem
                  title={t('apiConfiguration.title')}
                  descriptionOutside={
                    <div className="space-y-4 mt-4">
                    {/* API URL */}
                    <div className="space-y-2">
                      <Label htmlFor="apiUrl">
                        {t('apiConfiguration.apiUrl.label')} <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="apiUrl"
                        type="url"
                        placeholder={t('apiConfiguration.apiUrl.placeholder')}
                        value={config.apiUrl}
                        onChange={(e) => handleChange('apiUrl', e.target.value)}
                      />
                      <p className="text-xs text-main-view-fg/50">
                        {t('apiConfiguration.apiUrl.description')}
                      </p>
                    </div>

                    {/* Task */}
                    <div className="space-y-2">
                      <Label htmlFor="task">{t('apiConfiguration.task.label')}</Label>
                      <select
                        id="task"
                        className="h-9 px-3 py-1 rounded-md border border-main-view-fg/10 bg-transparent text-sm"
                        value={config.task || 'transcribe'}
                        onChange={(e) => handleChange('task', e.target.value)}
                      >
                        <option value="transcribe">{t('apiConfiguration.task.transcribe')}</option>
                        <option value="translate">{t('apiConfiguration.task.translate')}</option>
                      </select>
                      <p className="text-xs text-main-view-fg/50">
                        {t('apiConfiguration.task.description')}
                      </p>
                    </div>

                    {/* Language */}
                    <div className="space-y-2">
                      <Label htmlFor="language">{t('apiConfiguration.language.label')}</Label>
                      <Input
                        id="language"
                        type="text"
                        placeholder={t('apiConfiguration.language.placeholder')}
                        value={config.language || 'auto'}
                        onChange={(e) => handleChange('language', e.target.value)}
                      />
                      <p className="text-xs text-main-view-fg/50">
                        {t('apiConfiguration.language.description')}
                      </p>
                    </div>

                    {/* Output Format */}
                    <div className="space-y-2">
                      <Label htmlFor="output">{t('apiConfiguration.output.label')}</Label>
                      <select
                        id="output"
                        className="h-9 px-3 py-1 rounded-md border border-main-view-fg/10 bg-transparent text-sm"
                        value={config.output || 'txt'}
                        onChange={(e) => handleChange('output', e.target.value)}
                      >
                        <option value="txt">{t('apiConfiguration.output.txt')}</option>
                        <option value="json">{t('apiConfiguration.output.json')}</option>
                        <option value="vtt">{t('apiConfiguration.output.vtt')}</option>
                        <option value="srt">{t('apiConfiguration.output.srt')}</option>
                        <option value="tsv">{t('apiConfiguration.output.tsv')}</option>
                      </select>
                      <p className="text-xs text-main-view-fg/50">
                        {t('apiConfiguration.output.description')}
                      </p>
                    </div>

                    {/* VAD Filter */}
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="vadFilter"
                        checked={config.vadFilter || false}
                        onChange={(e) =>
                          setConfig((prev) => ({ ...prev, vadFilter: e.currentTarget.checked }))
                        }
                      />
                      <div className="space-y-0.5">
                        <Label htmlFor="vadFilter" className="cursor-pointer">
                          {t('apiConfiguration.vadFilter.label')}
                        </Label>
                        <p className="text-xs text-main-view-fg/50">
                          {t('apiConfiguration.vadFilter.description')}
                        </p>
                      </div>
                    </div>

                    {/* Word Timestamps */}
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="wordTimestamps"
                        checked={config.wordTimestamps || false}
                        onChange={(e) =>
                          setConfig((prev) => ({ ...prev, wordTimestamps: e.currentTarget.checked }))
                        }
                      />
                      <div className="space-y-0.5">
                        <Label htmlFor="wordTimestamps" className="cursor-pointer">
                          {t('apiConfiguration.wordTimestamps.label')}
                        </Label>
                        <p className="text-xs text-main-view-fg/50">
                          {t('apiConfiguration.wordTimestamps.description')}
                        </p>
                      </div>
                    </div>
                    {/* Close wrapper for descriptionOutside */}
                    </div>
                  }
                />
              </Card>

              {/* Actions */}
              <div className="flex items-center gap-3">
                <Button
                  onClick={handleSave}
                  disabled={isSaving || !config.apiUrl}
                  className="min-w-[120px]"
                >
                  {isSaving ? (
                    <>
                      <IconLoader2 size={16} className="animate-spin mr-2" />
                      {t('actions.saving')}
                    </>
                  ) : (
                    <>
                      <IconCheck size={16} className="mr-2" />
                      {t('actions.save')}
                    </>
                  )}
                </Button>

                <Button
                  onClick={handleTest}
                  variant="default"
                  disabled={isTesting || !config.apiUrl}
                  className="min-w-[120px]"
                >
                  {isTesting ? (
                    <>
                      <IconLoader2 size={16} className="animate-spin mr-2" />
                      {recorderState.isRecording ? t('actions.recording') : t('actions.testing')}
                    </>
                  ) : (
                    <>
                      <IconMicrophone size={16} className="mr-2" />
                      {t('actions.test')}
                    </>
                  )}
                </Button>
              </div>

              {/* Usage Instructions */}
              <Card>
                <CardItem
                  title={t('howToUse.title')}
                  descriptionOutside={
                    <div className="space-y-3 mt-4 text-sm text-main-view-fg/70">
                      <div className="flex items-start space-x-3">
                        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent/20 text-accent flex items-center justify-center text-xs font-semibold">
                          1
                        </span>
                        <p>
                          {t('howToUse.step1')}
                        </p>
                      </div>
                      <div className="flex items-start space-x-3">
                        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent/20 text-accent flex items-center justify-center text-xs font-semibold">
                          2
                        </span>
                        <p>{t('howToUse.step2')}</p>
                      </div>
                      <div className="flex items-start space-x-3">
                        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent/20 text-accent flex items-center justify-center text-xs font-semibold">
                          3
                        </span>
                        <p>
                          {t('howToUse.step3')}
                        </p>
                      </div>
                      <div className="flex items-start space-x-3">
                        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent/20 text-accent flex items-center justify-center text-xs font-semibold">
                          4
                        </span>
                        <p>
                          {t('howToUse.step4')}
                        </p>
                      </div>
                    </div>
                  }
                />
              </Card>

              {/* API Information */}
              <Card>
                <CardItem
                  title={t('apiInfo.title')}
                  descriptionOutside={
                    <div className="space-y-2 mt-4 text-sm text-main-view-fg/70">
                      <p>
                        <strong>{t('apiInfo.yourApi')}</strong>{' '}
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
                        <strong>{t('apiInfo.implementation')}</strong> ahmetoner/whisper-asr-webservice
                      </p>
                      <p>
                        <strong>{t('apiInfo.endpoint')}</strong> {t('apiInfo.endpointValue')}
                      </p>
                      <p>
                        <strong>{t('apiInfo.supportedFormats')}</strong> {t('apiInfo.formatsValue')}
                      </p>
                    </div>
                  }
                />
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
