/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from '@tanstack/react-router'
import ChatInput from '@/containers/ChatInput'
import HeaderPage from '@/containers/HeaderPage'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { route } from '@/constants/routes'
import { Button } from '@/components/ui/button'
import { useServiceHub } from '@/hooks/useServiceHub'
import { Laptop, Folder } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

export const Route = createFileRoute(route.code as any)({
  component: CodePage,
})

function CodePage() {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const [folder, setFolder] = useState<string | null>(null)

  const folderName = folder ? folder.split(/[/\\]/).pop() : undefined

  const handleSelectFolder = async () => {
    const selected = await serviceHub.dialog().open({
      multiple: false,
      directory: true,
      defaultPath: folder ?? undefined,
    })
    if (typeof selected === 'string') {
      setFolder(selected)
    }
  }

  // Placeholder: the code-session backend is not wired yet, so we intercept the
  // submit here instead of letting ChatInput create a chat thread and navigate.
  const handleSubmit = (text: string) => {
    toast.info(text)
  }

  const folderControls = (
    <>
      <Button variant="outline" size="sm" className="h-7 gap-1.5 rounded-full">
        <Laptop size={14} className="text-muted-foreground" />
        <span>{t('common:local')}</span>
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 rounded-full max-w-[220px]"
        onClick={handleSelectFolder}
        title={folder ?? undefined}
      >
        <Folder size={14} className="text-muted-foreground" />
        <span className="truncate">{folderName ?? t('common:selectFolder')}</span>
      </Button>
    </>
  )

  return (
    <div className="flex h-full flex-col">
      <HeaderPage>
        <span className="font-medium">{t('common:newSession')}</span>
      </HeaderPage>
      <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center px-3">
        <h1 className="text-2xl font-studio font-medium">
          {t('common:newSession')}
        </h1>
      </div>
      <div className="px-3 pb-4 shrink-0">
        <div className="mx-auto w-full md:w-4/5 xl:w-4/6">
          <div className="flex items-center gap-2 px-1 pb-2">
            {folderControls}
          </div>
          <ChatInput
            showSpeedToken={false}
            initialMessage={true}
            onSubmit={handleSubmit}
          />
        </div>
      </div>
    </div>
  )
}
