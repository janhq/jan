import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  SCREEN_CAPTURE_COMMIT_EVENT,
  type ScreenCaptureCommitDetail,
  JAN_SCREEN_CAPTURE_PNG_EVENT,
} from '@/constants/screenCapture'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import {
  closeScreenCaptureOverlayWindow,
  openScreenCaptureOverlayWindow,
} from '@/lib/screenCaptureWindows'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'

function buildComposedPrompt(ocr: string, template: string): string {
  const t = template.trim()
  const body = ocr.trim()
  if (!t) return body
  if (!body) return t
  return `${t}\n\n${body}`
}

export function ScreenCaptureProvider() {
  const screenCaptureToTextEnabled = useGeneralSetting(
    (s) => s.screenCaptureToTextEnabled
  )
  const screenCaptureShortcut = useGeneralSetting((s) => s.screenCaptureShortcut)
  const screenCaptureFloatingToolbarEnabled = useGeneralSetting(
    (s) => s.screenCaptureFloatingToolbarEnabled
  )

  const [dialogOpen, setDialogOpen] = useState(false)
  const [draftText, setDraftText] = useState('')

  const busyRef = useRef(false)
  const registeredShortcutRef = useRef<string | null>(null)
  const runCaptureRef = useRef<() => Promise<void>>(async () => {})

  const isMainWebview =
    IS_TAURI && getCurrentWebviewWindow().label === 'main'

  const processPngBase64 = useCallback(async (b64: string) => {
    if (!isMainWebview || busyRef.current) return
    busyRef.current = true
    const ocrToast = toast.loading('Reading text (on-device OCR)…')
    try {
      const { recognize } = await import('tesseract.js')
      const dataUrl = `data:image/png;base64,${b64}`
      const { data } = await recognize(dataUrl, 'eng')
      toast.dismiss(ocrToast)

      const raw = data.text ?? ''
      const trimmed = raw.trim()
      if (!trimmed) {
        toast.message('No text detected', {
          description: 'Edit below if you still want to add a message.',
        })
      } else {
        toast.success('Text extracted from screen')
      }

      setDraftText(raw)
      setDialogOpen(true)

      try {
        await getCurrentWebviewWindow().setFocus()
      } catch {
        /* ignore */
      }
    } catch (e) {
      toast.dismiss(ocrToast)
      toast.error('OCR failed', { description: String(e) })
    } finally {
      busyRef.current = false
    }
  }, [isMainWebview])

  const runCapture = useCallback(async () => {
    if (!isMainWebview || busyRef.current) return
    busyRef.current = true
    const loadingId = toast.loading('Capturing screen…')
    try {
      const b64 = await invoke<string>('capture_primary_display_png_base64')
      toast.dismiss(loadingId)
      busyRef.current = false
      await processPngBase64(b64)
    } catch (e) {
      toast.dismiss(loadingId)
      toast.error('Screen capture failed', {
        description: String(e),
      })
      busyRef.current = false
    }
  }, [isMainWebview, processPngBase64])

  runCaptureRef.current = runCapture

  useEffect(() => {
    if (!isMainWebview) return

    let unlisten: (() => void) | undefined
    void listen<{ base64: string }>(JAN_SCREEN_CAPTURE_PNG_EVENT, (ev) => {
      const b64 = ev.payload?.base64
      if (typeof b64 === 'string' && b64.length > 0) {
        void processPngBase64(b64)
      }
    }).then((fn) => {
      unlisten = fn
    })

    return () => {
      unlisten?.()
    }
  }, [isMainWebview, processPngBase64])

  useEffect(() => {
    if (!isMainWebview) return

    const syncShortcut = async () => {
      const { register, unregister } = await import(
        '@tauri-apps/plugin-global-shortcut'
      )

      if (registeredShortcutRef.current) {
        try {
          await unregister(registeredShortcutRef.current)
        } catch {
          /* ignore */
        }
        registeredShortcutRef.current = null
      }

      if (!screenCaptureToTextEnabled) return

      const shortcut = screenCaptureShortcut.trim()
      if (!shortcut) return

      try {
        await register(shortcut, (event) => {
          if (event.state !== 'Pressed') return
          void runCaptureRef.current()
        })
        registeredShortcutRef.current = shortcut
      } catch (e) {
        console.error(e)
        toast.error('Could not register screen capture shortcut', {
          description: String(e),
        })
      }
    }

    void syncShortcut()

    return () => {
      void (async () => {
        const shortcut = registeredShortcutRef.current
        if (!shortcut) return
        try {
          const { unregister } = await import(
            '@tauri-apps/plugin-global-shortcut'
          )
          await unregister(shortcut)
        } catch {
          /* ignore */
        }
        registeredShortcutRef.current = null
      })()
    }
  }, [isMainWebview, screenCaptureToTextEnabled, screenCaptureShortcut])

  useEffect(() => {
    if (!isMainWebview) return
    if (screenCaptureToTextEnabled && screenCaptureFloatingToolbarEnabled) {
      void openScreenCaptureOverlayWindow().catch((err) => {
        console.error(err)
        toast.error('Could not open capture toolbar', {
          description: String(err),
        })
      })
    } else {
      void closeScreenCaptureOverlayWindow()
    }
  }, [
    isMainWebview,
    screenCaptureToTextEnabled,
    screenCaptureFloatingToolbarEnabled,
  ])

  const commit = (sendNow: boolean) => {
    const template =
      useGeneralSetting.getState().screenCaptureInstructionTemplate ?? ''
    const text = buildComposedPrompt(draftText, template)
    if (!text.trim()) {
      toast.error('Nothing to insert')
      return
    }
    window.dispatchEvent(
      new CustomEvent<ScreenCaptureCommitDetail>(SCREEN_CAPTURE_COMMIT_EVENT, {
        detail: { text, sendNow },
      })
    )
    setDialogOpen(false)
    setDraftText('')
  }

  const handleDialogOpenChange = (open: boolean) => {
    setDialogOpen(open)
    if (!open) setDraftText('')
  }

  if (!IS_TAURI || !isMainWebview) return null

  return (
    <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="sm:max-w-2xl" showCloseButton>
        <DialogHeader>
          <DialogTitle>Screen text</DialogTitle>
          <DialogDescription>
            Text was read from your screen with on-device OCR. Edit it, then
            insert it into the chat input or send it immediately.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          className="min-h-[200px] font-mono text-sm"
          spellCheck
        />
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => handleDialogOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" variant="secondary" onClick={() => commit(false)}>
            Insert into chat
          </Button>
          <Button type="button" onClick={() => commit(true)}>
            Insert & send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
