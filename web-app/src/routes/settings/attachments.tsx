import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Card, CardItem } from '@/containers/Card'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { useAttachments } from '@/hooks/useAttachments'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { PlatformGuard } from '@/lib/platform/PlatformGuard'
import { PlatformFeature } from '@/lib/platform/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.attachments as any)({
  component: AttachmentsSettings,
})

function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
}) {
  return (
    <Input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-28"
    />
  )
}

function AttachmentsSettings() {
  const { t } = useTranslation()
  const {
    enabled,
    maxFileSizeMB,
    retrievalLimit,
    retrievalThreshold,
    chunkSizeTokens,
    overlapTokens,
    setEnabled,
    setMaxFileSizeMB,
    setRetrievalLimit,
    setRetrievalThreshold,
    setChunkSizeTokens,
    setOverlapTokens,
  } = useAttachments()

  return (
    <PlatformGuard feature={PlatformFeature.ATTACHMENTS}>
      <div className="flex h-full w-full">
        <div className="hidden sm:flex">
          <SettingsMenu />
        </div>
        <div className="flex-1">
        <HeaderPage
          title={t('common:attachments') || 'Attachments'}
          subtitle={
            t('settings:attachments.subtitle') ||
            'Configure document attachments, size limits, and retrieval behavior.'
          }
        />
        <div className="px-6 py-3 space-y-4">
          <Card title={t('settings:attachments.featureTitle') || 'Feature'}>
            <CardItem
              title={t('settings:attachments.enable') || 'Enable Attachments'}
              description={
                t('settings:attachments.enableDesc') ||
                'Allow uploading and indexing documents for retrieval.'
              }
              actions={
                <Switch checked={enabled} onCheckedChange={setEnabled} />
              }
            />
          </Card>

          <Card title={t('settings:attachments.limitsTitle') || 'Limits'}>
            <CardItem
              title={t('settings:attachments.maxFile') || 'Max File Size (MB)'}
              description={
                t('settings:attachments.maxFileDesc') ||
                'Maximum size per file. Enforced at upload and processing time.'
              }
              actions={
                <NumberInput
                  value={maxFileSizeMB}
                  onChange={setMaxFileSizeMB}
                  min={1}
                  max={200}
                />
              }
            />
          </Card>

          <Card title={t('settings:attachments.retrievalTitle') || 'Retrieval'}>
            <CardItem
              title={t('settings:attachments.topK') || 'Top-K'}
              description={
                t('settings:attachments.topKDesc') || 'Maximum citations to return.'
              }
              actions={
                <NumberInput
                  value={retrievalLimit}
                  onChange={setRetrievalLimit}
                  min={1}
                  max={10}
                />
              }
            />
            <CardItem
              title={
                t('settings:attachments.threshold') || 'Affinity Threshold'
              }
              description={
                t('settings:attachments.thresholdDesc') ||
                'Minimum similarity score to consider relevant (0-1).'
              }
              actions={
                <Input
                  type="number"
                  value={retrievalThreshold}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(e) => setRetrievalThreshold(Number(e.target.value))}
                  className="w-28"
                />
              }
            />
          </Card>

          <Card title={t('settings:attachments.chunkingTitle') || 'Chunking'}>
            <CardItem
              title={
                t('settings:attachments.chunkSize') || 'Chunk Size (tokens)'
              }
              description={
                t('settings:attachments.chunkSizeDesc') ||
                'Approximate max tokens per chunk for embeddings.'
              }
              actions={
                <NumberInput
                  value={chunkSizeTokens}
                  onChange={setChunkSizeTokens}
                  min={64}
                  max={8192}
                />
              }
            />
            <CardItem
              title={
                t('settings:attachments.chunkOverlap') || 'Overlap (tokens)'
              }
              description={
                t('settings:attachments.chunkOverlapDesc') ||
                'Token overlap between consecutive chunks.'
              }
              actions={
                <NumberInput
                  value={overlapTokens}
                  onChange={setOverlapTokens}
                  min={0}
                  max={1024}
                />
              }
            />
          </Card>
        </div>
      </div>
      </div>
    </PlatformGuard>
  )
}
