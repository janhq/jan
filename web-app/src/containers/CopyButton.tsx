import { Button } from '@/components/ui/button'
import { IconCopy, IconCopyCheck } from '@tabler/icons-react'
import { useState } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'

export const CopyButton = ({ text }: { text: string }) => {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={handleCopy}
      aria-label={copied ? t('common:copied') : t('common:copy')}
      title={copied ? t('common:copied') : t('common:copy')}
    >
      {copied ? (
        <>
          <IconCopyCheck size={16} className="text-primary" aria-hidden="true" />
        </>
      ) : (
        <IconCopy size={16} aria-hidden="true" />
      )}
    </Button>
  )
}
