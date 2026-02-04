import { useState } from 'react'
import { IconSparkles, IconLoader } from '@tabler/icons-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { usePromptEnhancer } from '@/hooks/usePromptEnhancer'
import { getModelOptimizationHints } from '@/utils/promptEnhancer'
import { EnhancementDiffView } from './EnhancementDiffView'

interface EnhancePromptButtonProps {
  prompt: string
  onEnhanced: (enhanced: string) => void
  modelName?: string
  disabled?: boolean
}

export function EnhancePromptButton({
  prompt,
  onEnhanced,
  modelName,
  disabled,
}: EnhancePromptButtonProps) {
  const [open, setOpen] = useState(false)
  const [enhanced, setEnhanced] = useState<string>('')
  const [improvements, setImprovements] = useState<string[]>([])
  const [reasoning, setReasoning] = useState<string>('')
  const [showDiff, setShowDiff] = useState(false)
  const { enhance, isEnhancing } = usePromptEnhancer()

  const handleEnhance = async (
    focus: 'clarity' | 'detail' | 'conciseness' | 'creativity' | 'technical'
  ) => {
    if (!prompt.trim()) return

    try {
      const result = await enhance({
        originalPrompt: prompt,
        targetModel: modelName,
        focus,
      })

      setEnhanced(result.enhanced)
      setImprovements(result.improvements)
      setReasoning(result.reasoning || '')
    } catch (error) {
      console.error('Enhancement failed:', error)
    }
  }

  const handleApply = () => {
    onEnhanced(enhanced)
    setOpen(false)
    setEnhanced('')
    setImprovements([])
    setReasoning('')
    setShowDiff(false)
  }

  const optimizationHints = modelName
    ? getModelOptimizationHints(modelName)
    : []

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || !prompt.trim() || prompt.length < 10}
          className="gap-1.5 h-7 px-2 text-xs"
          title="Enhance prompt with AI"
        >
          <IconSparkles size={14} />
          <span>Enhance</span>
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-96 p-0" align="end">
        <div className="p-3 border-b border-main-view-fg/10">
          <div className="flex items-center gap-2 mb-2">
            <IconSparkles size={16} className="text-purple-500" />
            <h3 className="font-medium text-sm">Enhance Prompt</h3>
          </div>
          <p className="text-xs text-main-view-fg/60">
            Optimize your prompt for better results
          </p>
        </div>

        {modelName && optimizationHints.length > 0 && (
          <div className="p-3 border-b border-main-view-fg/10 bg-blue-500/5">
            <p className="text-xs font-medium mb-1.5">Model: {modelName}</p>
            <div className="space-y-1">
              {optimizationHints.map((hint, i) => (
                <div
                  key={i}
                  className="text-xs text-main-view-fg/70 flex items-start gap-1.5"
                >
                  <span className="text-blue-500 mt-0.5">•</span>
                  <span>{hint}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="p-3 space-y-2">
          <p className="text-xs text-main-view-fg/70 mb-2">
            Choose enhancement focus:
          </p>

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleEnhance('clarity')}
              disabled={isEnhancing}
              className="justify-start text-xs h-auto py-2"
            >
              <div className="text-left">
                <div className="font-medium">Clarity</div>
                <div className="text-xs text-main-view-fg/60 font-normal">
                  Clear & precise
                </div>
              </div>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => handleEnhance('detail')}
              disabled={isEnhancing}
              className="justify-start text-xs h-auto py-2"
            >
              <div className="text-left">
                <div className="font-medium">Detail</div>
                <div className="text-xs text-main-view-fg/60 font-normal">
                  More specific
                </div>
              </div>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => handleEnhance('conciseness')}
              disabled={isEnhancing}
              className="justify-start text-xs h-auto py-2"
            >
              <div className="text-left">
                <div className="font-medium">Concise</div>
                <div className="text-xs text-main-view-fg/60 font-normal">
                  Brief & direct
                </div>
              </div>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => handleEnhance('creativity')}
              disabled={isEnhancing}
              className="justify-start text-xs h-auto py-2"
            >
              <div className="text-left">
                <div className="font-medium">Creative</div>
                <div className="text-xs text-main-view-fg/60 font-normal">
                  Innovative
                </div>
              </div>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => handleEnhance('technical')}
              disabled={isEnhancing}
              className="justify-start text-xs h-auto py-2 col-span-2"
            >
              <div className="text-left">
                <div className="font-medium">Technical</div>
                <div className="text-xs text-main-view-fg/60 font-normal">
                  Precise & detailed
                </div>
              </div>
            </Button>
          </div>
        </div>

        {isEnhancing && (
          <div className="p-3 border-t border-main-view-fg/10 flex items-center justify-center gap-2 text-sm text-main-view-fg/70">
            <IconLoader size={16} className="animate-spin" />
            <span>Enhancing prompt...</span>
          </div>
        )}

        {enhanced && (
          <div className="p-3 border-t border-main-view-fg/10 space-y-3 max-h-96 overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium">Enhanced Result:</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowDiff(!showDiff)}
                className="h-6 px-2 text-xs"
              >
                {showDiff ? 'Simple View' : 'Diff View'}
              </Button>
            </div>

            {showDiff ? (
              <EnhancementDiffView
                original={prompt}
                enhanced={enhanced}
                improvements={improvements}
                reasoning={reasoning}
              />
            ) : (
              <>
                <div>
                  <p className="text-xs font-medium mb-1.5">Enhanced Prompt:</p>
                  <div className="text-xs bg-main-view-fg/5 rounded p-2 border border-main-view-fg/10">
                    {enhanced}
                  </div>
                </div>

                {improvements.length > 0 && (
                  <div>
                    <p className="text-xs font-medium mb-1.5">Improvements:</p>
                    <ul className="space-y-1">
                      {improvements.map((imp, i) => (
                        <li
                          key={i}
                          className="text-xs text-main-view-fg/70 flex items-start gap-1.5"
                        >
                          <span className="text-green-500 mt-0.5">✓</span>
                          <span>{imp}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}

            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEnhanced('')
                  setImprovements([])
                  setReasoning('')
                  setShowDiff(false)
                }}
                className="flex-1"
              >
                Try Again
              </Button>
              <Button size="sm" onClick={handleApply} className="flex-1">
                Apply
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
