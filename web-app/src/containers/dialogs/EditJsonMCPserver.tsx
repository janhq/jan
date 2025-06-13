import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { MCPServerConfig } from '@/hooks/useMCPServers'
import CodeEditor from '@uiw/react-textarea-code-editor'
import '@uiw/react-textarea-code-editor/dist.css'

interface EditJsonMCPserverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  serverName: string | null // null means editing all servers
  initialData: MCPServerConfig | Record<string, MCPServerConfig>
  onSave: (data: MCPServerConfig | Record<string, MCPServerConfig>) => void
}

export default function EditJsonMCPserver({
  open,
  onOpenChange,
  serverName,
  initialData,
  onSave,
}: EditJsonMCPserverProps) {
  const [jsonContent, setJsonContent] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Initialize the editor with the provided data
  useEffect(() => {
    if (open && initialData) {
      try {
        setJsonContent(JSON.stringify(initialData, null, 2))
        setError(null)
      } catch {
        setError('Failed to parse initial data')
      }
    }
  }, [open, initialData])

  const handlePaste = (e: React.ClipboardEvent) => {
    const pastedText = e.clipboardData.getData('text')
    try {
      const parsedJson = JSON.parse(pastedText)
      const prettifiedJson = JSON.stringify(parsedJson, null, 2)
      e.preventDefault()
      setJsonContent(prettifiedJson)
      setError(null)
    } catch (error) {
      e.preventDefault()
      setError('Invalid JSON format in pasted content')
      console.error('Paste error:', error)
    }
  }

  const handleSave = () => {
    try {
      const parsedData = JSON.parse(jsonContent)
      onSave(parsedData)
      onOpenChange(false)
      setError(null)
    } catch {
      setError('Invalid JSON format')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {serverName
              ? `Edit JSON for MCP Server: ${serverName}`
              : 'Edit All MCP Servers JSON'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <div className="border border-main-view-fg/10 rounded-md overflow-hidden">
            <CodeEditor
              value={jsonContent}
              language="json"
              placeholder="Enter JSON configuration"
              onChange={(e) => setJsonContent(e.target.value)}
              onPaste={handlePaste}
              style={{
                fontFamily: 'ui-monospace',
                backgroundColor: 'transparent',
              }}
              className="w-full !text-sm "
            />
          </div>
          {error && <div className="text-destructive text-sm">{error}</div>}
        </div>

        <DialogFooter>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
