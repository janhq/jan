import { useMemo, useState } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ModelLogo } from '@/containers/ModelLogo'
import { MlxModelDownloadAction } from '@/containers/MlxModelDownloadAction'
import { useModelProvider } from '@/hooks/useModelProvider'
import type { CatalogModel } from '@/services/models/types'

interface DflashUnsupportedDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  modelId: string
  /// Starts an already-downloaded MLX model *with* its DFlash draft attached
  /// (no navigation to a new chat). Owned by the provider settings page so it
  /// can reuse the MLX engine + reconcile the provider's `dflash_enabled` flag.
  onStartWithDflash: (modelId: string) => Promise<void>
}

/// DFlash-supported base models, each paired with the concrete `mlx-community`
/// precision builds that actually exist on Hugging Face (verified against the
/// live HF API), ordered highest-precision-first so the default selection is
/// the largest available (bf16 where published). Every listed repo's
/// normalized base (via `normalizeBaseId`) resolves to a `STATIC_DRAFT_MAP`
/// key in `extensions/mlx-extension/src/dflashRegistry.ts` (the source of
/// truth) — so downloading any of them and toggling DFlash pairs a draft.
/// web-app can't import the extension directly (separate bundle), so this list
/// is mirrored here and MUST be kept in sync.
type QuantOption = { quant: string; repo: string }
type SupportedModel = {
  label: string
  prefix: string
  quants: readonly QuantOption[]
}

const mk = (
  label: string,
  prefix: string,
  ...suffixes: string[]
): SupportedModel => ({
  label,
  prefix,
  quants: suffixes.map((s) => ({ quant: s, repo: `mlx-community/${prefix}-${s}` })),
})

const DFLASH_SUPPORTED_MODELS: readonly SupportedModel[] = [
  mk('Qwen3.5-4B', 'Qwen3.5-4B', 'bf16', 'mxfp8', '8bit', '6bit', '4bit', 'mxfp4', '3bit'),
  mk('Qwen3.5-9B', 'Qwen3.5-9B', 'bf16', 'mxfp8', '8bit', '6bit', '5bit', '4bit', 'mxfp4', '3bit'),
  mk('Qwen3.5-27B', 'Qwen3.5-27B', 'bf16', 'mxfp8', '8bit', '6bit', '5bit', '4bit'),
  mk('Qwen3.5-35B-A3B', 'Qwen3.5-35B-A3B', 'bf16', '8bit', '6bit', '5bit', '4bit'),
  mk('Qwen3.5-122B-A10B', 'Qwen3.5-122B-A10B', 'bf16', 'mxfp8', '8bit', '6bit', '5bit', '4bit', 'mxfp4'),
  mk('Qwen3.6-27B', 'Qwen3.6-27B', 'bf16', 'mxfp8', '8bit', '6bit', '5bit', '4bit', 'mxfp4'),
  mk('Qwen3.6-35B-A3B', 'Qwen3.6-35B-A3B', 'bf16', 'mxfp8', '8bit', '6bit', '5bit', '4bit', 'mxfp4'),
  mk('Qwen3-4B', 'Qwen3-4B', 'bf16', '8bit', '6bit', '4bit', '3bit'),
  mk('Qwen3-8B', 'Qwen3-8B', 'bf16', '8bit', '6bit', '4bit', '3bit'),
  mk('Qwen3-Coder-Next', 'Qwen3-Coder-Next', 'bf16', 'mxfp8', '8bit', '6bit', '5bit', '4bit', 'mxfp4'),
  mk('Qwen3-Coder-30B-A3B', 'Qwen3-Coder-30B-A3B-Instruct', 'bf16', '8bit', '6bit', '5bit', '4bit', '3bit'),
  mk('gemma-4-26B-A4B-it', 'gemma-4-26b-a4b-it', 'bf16', 'mxfp8', '8bit', '6bit', '5bit', '4bit', 'mxfp4'),
  mk('gemma-4-31B-it', 'gemma-4-31b-it', 'bf16', 'mxfp8', '8bit', '6bit', '5bit', '4bit', 'mxfp4'),
  mk('gpt-oss-20b', 'gpt-oss-20b', 'mxfp4-bf16', 'MXFP4-Q8', 'MXFP4-Q4'),
  mk('gpt-oss-120b', 'gpt-oss-120b', 'mxfp4-bf16', 'MXFP4-Q8', '4bit', 'MXFP4-Q4'),
  mk('Kimi-K2.5', 'Kimi-K2.5', '3bit'),
  mk('Kimi-K2.6', 'Kimi-K2.6', 'mxfp8'),
  mk('MiniMax-M2.5', 'MiniMax-M2.5', '8bit', '6bit', '5bit', '4bit', '3bit'),
  mk('MiniMax-M2.7', 'MiniMax-M2.7', '8bit', '6bit', '5bit', '4bit', '3bit'),
  mk('LLaMA3.1-8B-Instruct', 'Meta-Llama-3.1-8B-Instruct', 'bf16', '8bit', '4bit', '3bit'),
]

/// Does a locally-downloaded MLX model id match the given base prefix + quant?
/// Matches the user's mental model ("I already have a 4B 4-bit") rather than an
/// exact repo id, so an alternate packaging like `Qwen3.5-4B-MLX-4bit` is
/// recognized even though we offer `mlx-community/Qwen3.5-4B-4bit`. The quant
/// tokens must appear as a contiguous run after the prefix so `mxfp4-bf16` and
/// `mxfp4-q8` don't collide.
function localIdMatches(id: string, prefix: string, quant: string): boolean {
  const idLc = (id.split('/').pop() ?? id).toLowerCase()
  const prefixLc = `${prefix.toLowerCase()}-`
  if (!idLc.startsWith(prefixLc)) return false
  const suffixTokens = idLc.slice(prefixLc.length).split('-')
  const quantTokens = quant.toLowerCase().split('-')
  return suffixTokens.some((_, i) =>
    quantTokens.every((qt, j) => suffixTokens[i + j] === qt)
  )
}

/// One model row: brand logo, name, a quant picker defaulting to the
/// highest-precision build, and an action that flips to "New chat" (start)
/// when a matching build is already on disk — even an alternate packaging of
/// the same base + quant — otherwise the shared MLX download action.
function SupportedModelRow({
  model,
  onStartWithDflash,
  onStarted,
}: {
  model: SupportedModel
  onStartWithDflash: (modelId: string) => Promise<void>
  onStarted: () => void
}) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<QuantOption>(model.quants[0])
  const providers = useModelProvider((s) => s.providers)

  // Already-downloaded build matching this base + selected quant (fuzzy: an
  // alternate packaging like `Qwen3.5-4B-MLX-4bit` still counts).
  const localId = useMemo(() => {
    const mlx = providers.find((p) => p.provider === 'mlx')
    return mlx?.models.find((m) =>
      localIdMatches(m.id, model.prefix, selected.quant)
    )?.id
  }, [providers, model.prefix, selected.quant])

  const catalogModel: CatalogModel = useMemo(
    () => ({
      model_name: selected.repo,
      developer: 'mlx-community',
      description: '',
      downloads: 0,
      is_mlx: true,
    }),
    [selected.repo]
  )

  const handleStart = () => {
    if (!localId) return
    // Close immediately and let the provider page surface load progress (its
    // Models-tab "starting" spinner + the global model-loading state). Keeping
    // the dialog open for the whole model load left a stuck/garbled spinner.
    onStarted()
    void onStartWithDflash(localId)
  }

  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <ModelLogo
        author="mlx-community"
        name={selected.repo}
        className="size-9 rounded-lg"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {model.label}
        </p>
        <p className="truncate text-xs text-muted-foreground">mlx-community</p>
      </div>
      <select
        value={selected.repo}
        onChange={(e) =>
          setSelected(
            model.quants.find((opt) => opt.repo === e.target.value) ??
              model.quants[0]
          )
        }
        className="h-7 shrink-0 rounded-md border border-border bg-transparent px-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      >
        {model.quants.map(({ quant, repo: optRepo }) => (
          <option key={optRepo} value={optRepo}>
            {quant}
          </option>
        ))}
      </select>
      {localId ? (
        <Button
          variant="default"
          size="sm"
          onClick={handleStart}
          className="min-w-[64px]"
        >
          {t('common:start', { defaultValue: 'Start' })}
        </Button>
      ) : (
        <MlxModelDownloadAction model={catalogModel} />
      )}
    </li>
  )
}

export function DflashUnsupportedDialog({
  open,
  onOpenChange,
  modelId,
  onStartWithDflash,
}: DflashUnsupportedDialogProps) {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] max-w-[90vw]">
        <DialogHeader>
          <DialogTitle className="font-bold">
            {t('settings:dflashUnsupportedTitle', {
              defaultValue: "DFlash isn't available for this model",
            })}
          </DialogTitle>
          <DialogDescription>
            {/* Composed manually instead of via i18n placeholders so the
                inline link to the z-lab/dflash collection stays a real
                anchor element (the t() return is a plain string). */}
            <span>
              {t('settings:dflashUnsupportedDescPrefix', {
                defaultValue:
                  "{{modelId}} doesn't have a paired draft model. Pick a supported one from the ",
                modelId,
              })}
            </span>
            <a
              href="https://huggingface.co/collections/z-lab/dflash"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#1F7CFF' }}
              /* `whitespace-nowrap` keeps "z-lab/dflash" on a single line:
                 the slash is otherwise a soft-wrap point, so the link
                 used to split as "z-lab/" + "dflash". Now it wraps as a
                 whole unit to the next line when it doesn't fit. */
              className="underline underline-offset-2 whitespace-nowrap"
            >
              z-lab/dflash
            </a>
            <span>
              {t('settings:dflashUnsupportedDescSuffix', {
                defaultValue:
                  ' collection to enable faster generation.',
              })}
            </span>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">
            {t('settings:dflashSupportedListTitle', {
              defaultValue: 'Supported models',
            })}
          </p>
          {/* Pick a quantization (defaults to the largest) and download or
              start the matching mlx-community build right here. */}
          <ul className="max-h-[320px] overflow-y-auto rounded-lg border border-border divide-y divide-border">
            {DFLASH_SUPPORTED_MODELS.map((model) => (
              <SupportedModelRow
                key={model.label}
                model={model}
                onStartWithDflash={onStartWithDflash}
                onStarted={() => onOpenChange(false)}
              />
            ))}
          </ul>
        </div>
        <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button
            size="sm"
            onClick={() => onOpenChange(false)}
            className="w-full sm:w-auto"
          >
            {t('common:ok', { defaultValue: 'OK' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
