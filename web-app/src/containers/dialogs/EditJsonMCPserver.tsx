import { useState, useEffect, useRef } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { MCPServerConfig, MCPServers, MCPSettings } from '@/hooks/useMCPServers'
import CodeEditor from '@uiw/react-textarea-code-editor'
import '@uiw/react-textarea-code-editor/dist.css'
import { useTranslation } from '@/i18n/react-i18next-compat'

import { normalizeAppError } from '@/utils/appError'

type MCPConfigJson =
  | MCPServerConfig
  | MCPServers
  | {
      mcpServers: MCPServers
      mcpSettings?: MCPSettings
    }

interface EditJsonMCPserverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  serverName: string | null // null means editing all servers
  initialData: MCPConfigJson
  onSave: (data: MCPConfigJson) => void | Promise<void>
}

export default function EditJsonMCPserver({
  open,
  onOpenChange,
  serverName,
  initialData,
  onSave,
}: EditJsonMCPserverProps) {
  const { t } = useTranslation()
  const [jsonContent, setJsonContent] = useState('')
  const [error, setError] = useState<string | null>(null)

  const savePending = useRef(false)
  const [saving, setSaving] = useState(false)

  // Initialize the editor with the provided data
  useEffect(() => {
    if (open && initialData) {
      try {
        setJsonContent(JSON.stringify(initialData, null, 2))
        setError(null)
      } catch {
        setError(t('mcp-servers:editJson.errorParse'))
      }
    }
    // Reinitialize only for a new editor session/data, not translation identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialData])

  const handlePaste = () => {
    // Clear any existing errors when pasting
    setError(null)
  }

  const handleSave = async () => {
    if (savePending.current) return
    savePending.current = true
    setSaving(true)
    setError(null)
    try {
      const parsedData = JSON.parse(jsonContent) as MCPConfigJson
      await onSave(parsedData)
      onOpenChange(false)
    } catch (error) {
      setError(error instanceof SyntaxError
        ? t('mcp-servers:editJson.errorFormat')
        : normalizeAppError(error))
    } finally {
      savePending.current = false
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!savePending.current) onOpenChange(value) }}>
      <DialogContent
        onInteractOutside={(e) => {
          e.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {serverName
              ? t('mcp-servers:editJson.title', { serverName })
              : t('mcp-servers:editJson.titleAll')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <div className="border  rounded-md overflow-hidden!">
            <style>{`
              .w-tc-editor textarea {
                word-break: break-all !important;
                overflow-wrap: anywhere !important;
                white-space: pre-wrap !important;
              }
              .w-tc-editor .token.string {
                word-break: break-all !important;
                overflow-wrap: anywhere !important;
              }
            `}</style>
            <CodeEditor
              value={jsonContent}
              language="json"
              placeholder={t('mcp-servers:editJson.placeholder')}
              onChange={(e) => setJsonContent(e.target.value)}
              onPaste={handlePaste}
              style={{
                backgroundColor: 'transparent',
                wordBreak: 'break-all',
                overflowWrap: 'anywhere',
                whiteSpace: 'pre-wrap',
              }}
              className="w-full text-sm! overflow-hidden break-all! font-mono!"
            />
          </div>
          {error && <div role="alert" className="text-destructive text-sm">{error}</div>}
        </div>

        <DialogFooter>
          <Button size="sm" disabled={saving} onClick={handleSave}>{t('mcp-servers:editJson.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
