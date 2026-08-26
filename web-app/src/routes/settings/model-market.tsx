import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Button } from '@/components/ui/button'
import { Card, CardItem } from '@/containers/Card'
import { Input } from '@/components/ui/input'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useHubSettings, DEFAULT_HF_MIRROR_BASE } from '@/lib/hubSettings'
import { clearAllIntros, countCachedIntros } from '@/lib/introStore'
import { setMirrorBase } from '@/lib/searchSources'
import { useState, useEffect } from 'react'
import { toast } from 'sonner'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.modelMarket as any)({
  component: ModelMarket,
})

function ModelMarket() {
  const { t } = useTranslation()
  const { hfMirrorBase, setHfMirrorBase, resetHfMirrorBase } = useHubSettings()
  const [mirrorInput, setMirrorInput] = useState(hfMirrorBase)
  const [introCount, setIntroCount] = useState(0)

  useEffect(() => {
    setMirrorInput(hfMirrorBase)
  }, [hfMirrorBase])

  useEffect(() => {
    setMirrorBase(hfMirrorBase)
  }, [hfMirrorBase])

  useEffect(() => {
    setIntroCount(countCachedIntros())
  }, [])

  const handleSaveMirror = () => {
    const trimmed = mirrorInput.trim().replace(/\/+$/, '')
    if (trimmed && !/^https?:\/\//.test(trimmed)) {
      toast.error(t('settings:modelMarket.mirrorInvalid'))
      return
    }
    setHfMirrorBase(trimmed)
    setMirrorBase(trimmed)
    toast.success(t('settings:modelMarket.mirrorSaved'))
  }

  const handleClearIntros = () => {
    const count = clearAllIntros()
    setIntroCount(0)
    toast.success(t('settings:modelMarket.introCacheCleared', { count }))
  }

  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div className="flex items-center gap-2 w-full">
          <span className="font-medium text-base font-studio">
            {t('common:modelMarket')}
          </span>
        </div>
      </HeaderPage>
      <div className="flex h-[calc(100%-60px)]">
        <SettingsMenu />
        <div className="p-4 pt-0 w-full overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
            {/* HF 镜像配置 */}
            <Card title={t('settings:modelMarket.hfMirrorBase')}>
              <CardItem
                title={t('settings:modelMarket.hfMirrorBase')}
                description={t('settings:modelMarket.hfMirrorBaseDesc')}
                className="items-start flex-row gap-y-2"
                actions={
                  <div className="flex items-center gap-2 w-full max-w-md">
                    <Input
                      value={mirrorInput}
                      onChange={(e) => setMirrorInput(e.target.value)}
                      placeholder={DEFAULT_HF_MIRROR_BASE}
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleSaveMirror}
                    >
                      {t('settings:modelMarket.save')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        resetHfMirrorBase()
                        setMirrorInput(DEFAULT_HF_MIRROR_BASE)
                        setMirrorBase(DEFAULT_HF_MIRROR_BASE)
                        toast.success(t('settings:modelMarket.mirrorSaved'))
                      }}
                    >
                      {t('settings:modelMarket.resetToDefault')}
                    </Button>
                  </div>
                }
              />
            </Card>

            {/* 简介缓存 */}
            <Card title={t('settings:modelMarket.clearIntroCache')}>
              <CardItem
                title={t('settings:modelMarket.clearIntroCache')}
                description={t('settings:modelMarket.clearIntroCacheDesc', {
                  count: introCount,
                })}
                actions={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleClearIntros}
                    disabled={introCount === 0}
                  >
                    {t('settings:modelMarket.clearIntroCache')}
                  </Button>
                }
              />
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
