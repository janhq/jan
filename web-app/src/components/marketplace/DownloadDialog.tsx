import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toGigabytes } from '@/lib/utils'
import {
  type FileTreeNode,
  extractQuantVersions,
  calcDownloadSize,
  countFileNodes,
} from '@/routes/marketplace/lib/modelFileUtils'

interface DownloadDialogProps {
  open: boolean
  modelName: string
  fileTree: FileTreeNode[]
  defaultSaveDir: string
  defaultQuant?: string | null
  onClose: () => void
  onConfirm: (quantDir: string | null, saveDir: string) => void
}

type DownloadMode = 'all' | 'single'

async function pickDirectory(): Promise<string | null> {
  try {
    // @ts-ignore
    // eslint-disable-next-line
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected: string | string[] | null = await open({ directory: true })
    if (selected === null) return null
    if (Array.isArray(selected)) return selected[0] ?? null
    return selected
  } catch {
    return null
  }
}

export function DownloadDialog(props: DownloadDialogProps) {
  const { open, modelName, fileTree, defaultSaveDir, defaultQuant, onClose, onConfirm } = props

  const quants = React.useMemo(() => extractQuantVersions(fileTree), [fileTree])

  const [mode, setMode] = React.useState<DownloadMode>('all')
  const [selectedQuant, setSelectedQuant] = React.useState<string>(
    quants[0] ?? ''
  )
  const [saveDir, setSaveDir] = React.useState<string>(defaultSaveDir)

  React.useEffect(() => {
    setSaveDir(defaultSaveDir)
  }, [defaultSaveDir])

  React.useEffect(() => {
    if (open && defaultQuant) {
      setMode('single')
      setSelectedQuant(defaultQuant)
    }
  }, [open, defaultQuant])

  const totalSizeAll = React.useMemo(
    () => calcDownloadSize(fileTree, null),
    [fileTree]
  )
  const totalFilesAll = React.useMemo(
    () => countFileNodes(fileTree),
    [fileTree]
  )

  const totalSizeSingle = React.useMemo(
    () => calcDownloadSize(fileTree, selectedQuant || null),
    [fileTree, selectedQuant]
  )

  const handleBrowse = React.useCallback(async () => {
    const picked = await pickDirectory()
    if (picked !== null) {
      setSaveDir(picked)
    }
  }, [])

  const handleConfirm = React.useCallback(() => {
    const quantDir = mode === 'single' ? selectedQuant || null : null
    onConfirm(quantDir, saveDir)
  }, [mode, selectedQuant, saveDir, onConfirm])

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>下载模型: {modelName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* Download scope */}
          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">下载范围</p>
            <div className="space-y-2">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="download-mode"
                  value="all"
                  checked={mode === 'all'}
                  onChange={() => setMode('all')}
                  className="mt-1"
                />
                <div className="text-sm">
                  <span className="text-foreground">全部量化版本</span>
                  <p className="text-xs text-muted-foreground">
                    共 {totalFilesAll} 个文件，{toGigabytes(totalSizeAll)}
                  </p>
                </div>
              </label>

              {quants.length > 0 && (
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="download-mode"
                    value="single"
                    checked={mode === 'single'}
                    onChange={() => setMode('single')}
                    className="mt-1"
                  />
                  <div className="flex-1 text-sm">
                    <span className="text-foreground">仅选择一个版本</span>
                    <div className="mt-1.5">
                      <select
                        value={selectedQuant}
                        onChange={(e) => setSelectedQuant(e.target.value)}
                        disabled={mode !== 'single'}
                        className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                      >
                        {quants.map((q) => (
                          <option key={q} value={q}>
                            {q}
                          </option>
                        ))}
                      </select>
                    </div>
                    {mode === 'single' && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {toGigabytes(totalSizeSingle)}
                      </p>
                    )}
                  </div>
                </label>
              )}
            </div>
          </div>

          {/* Save directory */}
          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">保存目录</p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={saveDir}
                onChange={(e) => setSaveDir(e.target.value)}
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="选择保存目录"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleBrowse}
              >
                浏览...
              </Button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end pt-4 border-t border-border">
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="button" onClick={handleConfirm}>
            开始下载
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
