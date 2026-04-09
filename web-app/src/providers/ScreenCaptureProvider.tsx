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
import {
  resolveScreenCaptureOcrLanguages,
  TESSERACT_LANG_AUTO,
} from '@/lib/screenCaptureOcrTesseract'

function buildComposedPrompt(ocr: string, template: string): string {
  const t = template.trim()
  const body = ocr.trim()
  if (!t) return body
  if (!body) return t
  return `${t}\n\n${body}`
}

/** OCR + settings template + optional note from the floating toolbar (quick-ask style). */
function buildScreenCaptureDraft(
  ocr: string,
  template: string,
  toolbarInstruction: string
): string {
  const ocrBlock = buildComposedPrompt(ocr, template)
  const hint = toolbarInstruction.trim()
  if (!hint) return ocrBlock
  if (!ocrBlock.trim()) return hint
  return `${hint}\n\n${ocrBlock}`
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

  const processPngBase64 = useCallback(
    async (b64: string, toolbarInstruction = '') => {
      if (!isMainWebview || busyRef.current) return
      busyRef.current = true
      const ocrToast = toast.loading('Reading text (on-device OCR)…')
      try {
        const { recognize } = await import('tesseract.js')
        const dataUrl = `data:image/png;base64,${b64}`
        const gs = useGeneralSetting.getState()
        const ocrLang = resolveScreenCaptureOcrLanguages(
          gs.screenCaptureOcrTesseractLang ?? TESSERACT_LANG_AUTO,
          gs.currentLanguage
        )
        // tesseract.js v6 `recognize()` creates and tears down a worker per call; fine for occasional captures.
        const { data } = await recognize(dataUrl, ocrLang)
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

        const template = gs.screenCaptureInstructionTemplate ?? ''
        setDraftText(buildScreenCaptureDraft(raw, template, toolbarInstruction))
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
    },
    [isMainWebview]
  )

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
    void listen<{ base64: string; instruction?: string }>(
      JAN_SCREEN_CAPTURE_PNG_EVENT,
      (ev) => {
        const b64 = ev.payload?.base64
        const instruction =
          typeof ev.payload?.instruction === 'string' ? ev.payload.instruction : ''
        if (typeof b64 === 'string' && b64.length > 0) {
          void processPngBase64(b64, instruction)
        }
      }
    ).then((fn) => {
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
    const text = draftText.trim()
    if (!text) {
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
            Text was read from your screen with on-device OCR. If you added an
            optional note after capture (in the floating toolbar or region step), it
            appears above the OCR. Edit, then insert into chat or send.
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
