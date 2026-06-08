import { useMemo } from 'react'
import type { Components } from 'react-markdown'
import { IconExternalLink, IconSparkles } from '@tabler/icons-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useWhatsNew } from '@/hooks/useWhatsNew'
import { useServiceHub } from '@/hooks/useServiceHub'

const WhatsNewDialog = () => {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const { open, currentVersion, release, acknowledge, githubUrl } =
    useWhatsNew()

  const markdownComponents = useMemo<Components>(
    () => ({
      a: ({ href, children, ...props }) => (
        <a
          {...props}
          href={href}
          onClick={(event) => {
            if (!href) return
            event.preventDefault()
            serviceHub
              .opener()
              .open(href)
              .catch(() => window.open(href, '_blank'))
          }}
        >
          {children}
        </a>
      ),
    }),
    [serviceHub]
  )

  if (!release) return null

  const handleOpenChange = (next: boolean) => {
    if (!next) acknowledge()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl lg:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconSparkles size={20} className="text-primary shrink-0" />
            <span>{t('whats-new:title', { version: currentVersion })}</span>
          </DialogTitle>
          <DialogDescription>{t('whats-new:subtitle')}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] overflow-y-auto pr-1">
          <RenderMarkdown
            content={release.body ?? ''}
            isAnimating={false}
            components={markdownComponents}
          />
        </div>

        <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {githubUrl && (
            <Button variant="ghost" size="sm" asChild>
              <a href={githubUrl} target="_blank" rel="noreferrer noopener">
                <IconExternalLink size={16} />
                {t('whats-new:openOnGithub')}
              </a>
            </Button>
          )}
          <Button size="sm" onClick={acknowledge}>
            {t('whats-new:gotIt')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default WhatsNewDialog
