import { useState, useEffect } from 'react'
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
  onSave: (data: MCPConfigJson) => void
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
  }, [open, initialData, t])

  const handlePaste = () => {
    // Clear any existing errors when pasting
    setError(null)
  }

  const handleSave = () => {
    try {
      const parsedData = JSON.parse(jsonContent) as MCPConfigJson
      onSave(parsedData)
      onOpenChange(false)
      setError(null)
    } catch {
      setError(t('mcp-servers:editJson.errorFormat'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
<<<<<<< HEAD
          <div className="border border-main-view-fg/10 rounded-md !overflow-hidden">
=======
          <div className="border  rounded-md overflow-hidden!">
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
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
<<<<<<< HEAD
              className="w-full !text-sm overflow-hidden !break-all !font-mono"
=======
              className="w-full text-sm! overflow-hidden break-all! font-mono!"
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
            />
          </div>
          {error && <div className="text-destructive text-sm">{error}</div>}
        </div>

        <DialogFooter>
<<<<<<< HEAD
          <Button onClick={handleSave}>{t('mcp-servers:editJson.save')}</Button>
=======
          <Button size="sm" onClick={handleSave}>{t('mcp-servers:editJson.save')}</Button>
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
