import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Card, CardItem } from '@/containers/Card'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  IconBrandGithub,
  IconBrandDiscord,
  IconBrandX,
  IconExternalLink,
} from '@tabler/icons-react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.about as any)({
  component: About,
})

function About() {
  const { t } = useTranslation()

  const openExternalLink = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="flex flex-col h-full">
      <HeaderPage>
        <h1 className="font-medium">{t('common.settings')}</h1>
      </HeaderPage>
      <div className="flex h-full w-full">
        <SettingsMenu />
        <div className="p-4 w-full h-[calc(100%-32px)] overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
            {/* About Jan */}
            <Card title="About Jan">
              <CardItem
                title="Version"
                actions={
                  <span className="text-main-view-fg/80">v{VERSION}</span>
                }
              />
              <CardItem
                title="Description"
                align="start"
                description="Jan is an open-source alternative to ChatGPT that runs 100% offline on your computer. It supports universal AI APIs and is designed to be the easiest way to run AI locally."
              />
              <CardItem
                title="License"
                description="Jan is licensed under the AGPLv3 License"
                actions={
                  <Button
                    variant="link"
                    size="sm"
                    className="hover:no-underline"
                    onClick={() =>
                      openExternalLink(
                        'https://github.com/janhq/jan/blob/main/LICENSE'
                      )
                    }
                  >
                    <div className="flex items-center gap-1">
                      <span>View License</span>
                      <IconExternalLink size={14} />
                    </div>
                  </Button>
                }
              />
            </Card>

            {/* Resources */}
            <Card title="Resources">
              <CardItem
                title="Documentation"
                description="Learn how to use Jan and explore its features"
                actions={
                  <Button
                    variant="link"
                    size="sm"
                    className="hover:no-underline"
                    onClick={() => openExternalLink('https://jan.ai/docs')}
                  >
                    <div className="flex items-center gap-1">
                      <span>View Docs</span>
                      <IconExternalLink size={14} />
                    </div>
                  </Button>
                }
              />
              <CardItem
                title="Release Notes"
                description="See what's new in the latest version"
                actions={
                  <Button
                    variant="link"
                    size="sm"
                    className="hover:no-underline"
                    onClick={() =>
                      openExternalLink('https://github.com/janhq/jan/releases')
                    }
                  >
                    <div className="flex items-center gap-1">
                      <span>View Releases</span>
                      <IconExternalLink size={14} />
                    </div>
                  </Button>
                }
              />
              <CardItem
                title="Privacy Policy"
                description="Learn about how we handle your data"
                actions={
                  <Button
                    variant="link"
                    size="sm"
                    className="hover:no-underline"
                    onClick={() => openExternalLink('https://jan.ai/privacy')}
                  >
                    <div className="flex items-center gap-1">
                      <span>View Policy</span>
                      <IconExternalLink size={14} />
                    </div>
                  </Button>
                }
              />
            </Card>

            {/* Community */}
            <Card title="Community">
              <CardItem
                title="GitHub"
                description="Contribute to Jan's development"
                actions={
                  <Button
                    variant="link"
                    size="sm"
                    className="hover:no-underline"
                    onClick={() =>
                      openExternalLink('https://github.com/janhq/jan')
                    }
                  >
                    <div className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/15 bg-main-view-fg/10 transition-all duration-200 ease-in-out">
                      <IconBrandGithub
                        size={18}
                        className="text-main-view-fg/50"
                      />
                    </div>
                  </Button>
                }
              />
              <CardItem
                title="Discord"
                description="Join our community for support and discussions"
                actions={
                  <Button
                    variant="link"
                    size="sm"
                    className="hover:no-underline"
                    onClick={() => openExternalLink('https://discord.gg/jan')}
                  >
                    <div className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/15 bg-main-view-fg/10 transition-all duration-200 ease-in-out">
                      <IconBrandDiscord
                        size={18}
                        className="text-main-view-fg/50"
                      />
                    </div>
                  </Button>
                }
              />
              <CardItem
                title="X (Twitter)"
                description="Follow us for updates and announcements"
                actions={
                  <Button
                    variant="link"
                    size="sm"
                    className="hover:no-underline"
                    onClick={() =>
                      openExternalLink('https://twitter.com/janframework')
                    }
                  >
                    <div className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/15 bg-main-view-fg/10 transition-all duration-200 ease-in-out">
                      <IconBrandX size={18} className="text-main-view-fg/50" />
                    </div>
                  </Button>
                }
              />
            </Card>

            {/* Support */}
            <Card title="Support">
              <CardItem
                title="Report an Issue"
                description="Found a bug? Let us know on GitHub"
                actions={
                  <Button
                    variant="link"
                    size="sm"
                    className="hover:no-underline"
                    onClick={() =>
                      openExternalLink(
                        'https://github.com/janhq/jan/issues/new'
                      )
                    }
                  >
                    <div className="flex items-center gap-1">
                      <span>Report Issue</span>
                      <IconExternalLink size={14} />
                    </div>
                  </Button>
                }
              />
              <CardItem
                title="Feature Requests"
                description="Have an idea? Share it with us"
                actions={
                  <Button
                    variant="link"
                    size="sm"
                    className="hover:no-underline"
                    onClick={() =>
                      openExternalLink(
                        'https://github.com/janhq/jan/discussions/categories/ideas'
                      )
                    }
                  >
                    <div className="flex items-center gap-1">
                      <span>Request Feature</span>
                      <IconExternalLink size={14} />
                    </div>
                  </Button>
                }
              />
            </Card>

            {/* Credits */}
            <Card title="Credits">
              <CardItem
                align="start"
                description={
                  <div className="text-main-view-fg/70">
                    <p>
                      Jan is built with ❤️ by the Jan team and contributors from
                      around the world.
                    </p>
                    <p className="mt-2">
                      Special thanks to all our open-source dependencies and the
                      amazing AI community.
                    </p>
                  </div>
                }
              />
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
