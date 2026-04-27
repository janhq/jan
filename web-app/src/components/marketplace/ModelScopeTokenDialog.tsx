import { type ReactNode, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface ModelScopeTokenDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  token: string | null
  onSave: (token: string) => void | Promise<void>
  onClear: () => void | Promise<void>
  inputId: string
  description: ReactNode
  emptyStateMessage: ReactNode
  inputPlaceholder?: string
  cancelLabel?: string
  saveLabelWhenEmpty?: string
  saveLabelWhenConfigured?: string
}

export function ModelScopeTokenDialog({
  open,
  onOpenChange,
  token,
  onSave,
  onClear,
  inputId,
  description,
  emptyStateMessage,
  inputPlaceholder = '输入 ModelScope Access Token',
  cancelLabel = '取消',
  saveLabelWhenEmpty = '保存',
  saveLabelWhenConfigured = '保存并替换',
}: ModelScopeTokenDialogProps) {
  const [tokenInput, setTokenInput] = useState('')
  const [confirmClearToken, setConfirmClearToken] = useState(false)

  useEffect(() => {
    if (!open) {
      setTokenInput('')
      setConfirmClearToken(false)
    }
  }, [open])

  const maskedTokenSuffix =
    token && token.length > 4 ? token.slice(-4) : token ?? ''

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setTokenInput('')
      setConfirmClearToken(false)
    }
    onOpenChange(nextOpen)
  }

  const handleSave = async () => {
    const trimmedToken = tokenInput.trim()
    if (!trimmedToken) return
    await onSave(trimmedToken)
  }

  const handleClear = async () => {
    await onClear()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>管理 ModelScope Token</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {token ? (
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-medium text-foreground">当前状态：已配置</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  当前 Token 已保存{maskedTokenSuffix ? `（尾号 ${maskedTokenSuffix}）` : ''}。
                </p>
              </div>
              <span className="rounded-full border border-green-500/30 bg-green-500/10 px-2 py-1 text-xs text-green-600">
                已配置
              </span>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700">
            {emptyStateMessage}
          </div>
        )}

        <div className="space-y-2">
          <label
            className="text-sm font-medium text-foreground"
            htmlFor={inputId}
          >
            {token ? '替换 Token' : '输入 Token'}
          </label>
          <input
            id={inputId}
            type="text"
            placeholder={inputPlaceholder}
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </div>

        {confirmClearToken && token && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p className="font-medium text-destructive">确认清除已保存的 Token？</p>
            <p className="mt-1 text-muted-foreground">
              清除后将无法查看需要鉴权的 ModelScope 模型详情。
            </p>
          </div>
        )}

        <DialogFooter className="sm:justify-between">
          <div className="flex gap-2">
            {token && !confirmClearToken && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setConfirmClearToken(true)}
              >
                清除 Token…
              </Button>
            )}
            {token && confirmClearToken && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmClearToken(false)}
                >
                  取消清除
                </Button>
                <Button variant="destructive" size="sm" onClick={handleClear}>
                  确认清除
                </Button>
              </>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => handleOpenChange(false)}>
              {cancelLabel}
            </Button>
            <Button size="sm" onClick={handleSave} disabled={!tokenInput.trim()}>
              {token ? saveLabelWhenConfigured : saveLabelWhenEmpty}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
