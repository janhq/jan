import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Button } from '@/components/ui/button'
import { useTranslation } from 'react-i18next'

import DocumentList from '../../containers/RAG/DocumentList'
import RAGSettings from '../../containers/RAG/RAGSettings'
import { useRAGNavigation } from '@/hooks/useRAG'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.rag as any)({
  component: RAG,
})

function RAG() {
  const { t } = useTranslation()
  const {
    selectedSetting: selectedRAGSetting,
    setSelectedSetting: setSelectedRAGSetting,
  } = useRAGNavigation()

  const renderContent = () => {
    switch (selectedRAGSetting) {
      case 'documents':
        return <DocumentList />
      case 'settings':
        return <RAGSettings />
      default:
        return <DocumentList />
    }
  }

  const navItems = [
    { id: 'documents', label: 'Documents', icon: '📄' },
    { id: 'settings', label: 'Settings', icon: '⚙️' },
  ]

  return (
    <div className="flex flex-col h-full">
      <HeaderPage>
        <h1 className="font-medium">{t('common.settings')}</h1>
      </HeaderPage>
      <div className="flex h-full w-full">
        <SettingsMenu />
        <div className="flex h-full flex-col w-full">
          <div className="border-b border-[hsla(var(--app-border))] px-4 py-3">
            <h1 className="text-lg font-semibold">RAG Document Management</h1>
            <p className="text-sm text-[hsla(var(--text-secondary))]">
              Manage your indexed documents and RAG settings
            </p>
          </div>

          <div className="border-b border-[hsla(var(--app-border))] px-4 py-2">
            <div className="flex gap-2">
              {navItems.map((item) => (
                <Button
                  key={item.id}
                  variant={selectedRAGSetting === item.id ? 'default' : 'link'}
                  size="sm"
                  onClick={() => setSelectedRAGSetting(item.id)}
                  className="flex items-center gap-2"
                >
                  <span>{item.icon}</span>
                  {item.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-auto">{renderContent()}</div>
        </div>
      </div>
    </div>
  )
}
