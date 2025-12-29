import {
  DropDrawer,
  DropDrawerContent,
  DropDrawerItem,
  DropDrawerSub,
  DropDrawerSubContent,
  DropDrawerSubTrigger,
  DropDrawerTrigger,
} from '@/components/ui/dropdrawer'
import {
  BriefcaseBusinessIcon,
  ChromiumIcon,
  CircleCheck,
  GlobeIcon,
  ImageIcon,
  Leaf,
  LightbulbIcon,
  TelescopeIcon,
  SmileIcon,
  type LucideIcon,
} from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { isExtensionAvailable } from '@janhq/mcp-web-client'
import { useIsMobileDevice } from '@/hooks/use-is-mobile-device'

type ToneOption = 'Friendly' | 'Concise' | 'Professional'

interface SettingChatInputProps {
  searchEnabled: boolean
  deepResearchEnabled: boolean
  browserEnabled: boolean
  reasoningEnabled: boolean
  imageGenerationEnabled?: boolean
  toggleInstruct: () => void
  toggleBrowser: () => void
  toggleSearch: () => void
  toggleDeepResearch: () => void
  toggleImageGeneration?: () => void
  isBrowserSupported: boolean
  isSupportTools: boolean
  isSupportReasoningToggle: boolean
  isSupportDeepResearch: boolean
  isSupportImageGeneration?: boolean
  disablePreferences: boolean
  selectedTone?: ToneOption
  onToneChange?: (tone: ToneOption) => void
  children: React.ReactNode
}

const toneOptions: { value: ToneOption; label: string; icon: LucideIcon }[] = [
  { value: 'Friendly', label: 'Friendly', icon: SmileIcon },
  { value: 'Concise', label: 'Concise', icon: CircleCheck },
  { value: 'Professional', label: 'Professional', icon: BriefcaseBusinessIcon },
]

declare const EXTENSION_ID: string
declare const CHROME_STORE_URL: string

export const SettingChatInput = ({
  searchEnabled,
  deepResearchEnabled,
  browserEnabled,
  reasoningEnabled,
  imageGenerationEnabled = false,
  toggleInstruct,
  toggleSearch,
  toggleDeepResearch,
  toggleBrowser,
  toggleImageGeneration,
  isBrowserSupported,
  isSupportTools,
  isSupportDeepResearch,
  isSupportReasoningToggle,
  isSupportImageGeneration = false,
  selectedTone = 'Friendly',
  disablePreferences,
  onToneChange,
  children,
}: SettingChatInputProps) => {
  const isMobileDevice = useIsMobileDevice()
  const shouldShowBrowserControl = !isMobileDevice && isBrowserSupported

  const toggleBrowserAttempt = async () => {
    if (!isBrowserSupported) return
    const browserUseAvailable = await isExtensionAvailable(EXTENSION_ID)
    if ((browserUseAvailable && !browserEnabled) || browserEnabled) {
      toggleBrowser()
    } else {
      // Redirect to chrome extension store
      window.open(CHROME_STORE_URL, '_blank')
    }
  }
  return (
    <DropDrawer>
      <DropDrawerTrigger asChild>{children}</DropDrawerTrigger>
      <DropDrawerContent align="start">
        <DropDrawerSub id="tone-submenu">
          {/* TODO remove hidden class when it's thread based */}
          <DropDrawerSubTrigger className="hidden">
            <div className="flex gap-2 items-center w-full">
              <Leaf />
              <span>Tone</span>
            </div>
          </DropDrawerSubTrigger>
          <DropDrawerSubContent className="w-56 max-h-80 overflow-auto">
            {toneOptions.map((tone) => (
              <DropDrawerItem
                key={tone.value}
                onSelect={(e) => {
                  e.preventDefault()
                  onToneChange?.(tone.value)
                }}
              >
                <div className="flex gap-2 items-center justify-between w-full">
                  <div className="flex gap-2 items-center w-full">
                    {tone.icon && <tone.icon />}
                    <span>{tone.label}</span>
                  </div>
                  {selectedTone === tone.value && (
                    <span className="text-xs">✓</span>
                  )}
                </div>
              </DropDrawerItem>
            ))}
          </DropDrawerSubContent>
        </DropDrawerSub>

        {isSupportReasoningToggle && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <DropDrawerItem
                  onSelect={(e) => e.preventDefault()}
                  disabled={deepResearchEnabled || disablePreferences}
                >
                  <div className="flex gap-2 items-center justify-between w-full">
                    <div className="flex gap-2 items-center w-full">
                      <LightbulbIcon />
                      <span>Think</span>
                    </div>
                    <Switch
                      disabled={disablePreferences}
                      checked={deepResearchEnabled ? true : reasoningEnabled}
                      onCheckedChange={toggleInstruct}
                    />
                  </div>
                </DropDrawerItem>
              </div>
            </TooltipTrigger>
          </Tooltip>
        )}
        {shouldShowBrowserControl && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <DropDrawerItem
                  onSelect={(e) => e.preventDefault()}
                  disabled={disablePreferences}
                >
                  <div className="flex gap-2 items-center justify-between w-full">
                    <div className="flex gap-2 items-center w-full">
                      <ChromiumIcon />
                      <span>Browse</span>
                    </div>
                    <Switch
                      checked={browserEnabled}
                      onCheckedChange={toggleBrowserAttempt}
                      disabled={disablePreferences}
                    />
                  </div>
                </DropDrawerItem>
              </div>
            </TooltipTrigger>
          </Tooltip>
        )}
        {isSupportTools && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <DropDrawerItem
                  onSelect={(e) => e.preventDefault()}
                  disabled={disablePreferences}
                >
                  <div className="flex gap-2 items-center justify-between w-full">
                    <div className="flex gap-2 items-center w-full">
                      <GlobeIcon />
                      <span>Search</span>
                    </div>
                    <Switch
                      checked={deepResearchEnabled ? true : searchEnabled}
                      onCheckedChange={toggleSearch}
                      disabled={deepResearchEnabled || disablePreferences}
                    />
                  </div>
                </DropDrawerItem>
              </div>
            </TooltipTrigger>
          </Tooltip>
        )}
        {isSupportDeepResearch && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <DropDrawerItem
                  onSelect={(e) => e.preventDefault()}
                  disabled={disablePreferences}
                >
                  <div className="flex gap-2 items-center justify-between w-full">
                    <div className="flex gap-2 items-center w-full">
                      <TelescopeIcon />
                      <span>Deep Research</span>
                    </div>
                    <Switch
                      checked={deepResearchEnabled}
                      onCheckedChange={toggleDeepResearch}
                      disabled={disablePreferences}
                    />
                  </div>
                </DropDrawerItem>
              </div>
            </TooltipTrigger>
          </Tooltip>
        )}
        {isSupportImageGeneration && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <DropDrawerItem
                  onSelect={(e) => e.preventDefault()}
                  disabled={!isSupportImageGeneration || disablePreferences}
                >
                  <div className="flex gap-2 items-center justify-between w-full">
                    <div className="flex gap-2 items-center w-full">
                      <ImageIcon />
                      <span>Create Image</span>
                    </div>
                    <Switch
                      checked={
                        imageGenerationEnabled &&
                        !deepResearchEnabled &&
                        !browserEnabled &&
                        !searchEnabled
                      }
                      onCheckedChange={toggleImageGeneration}
                      disabled={!isSupportImageGeneration || disablePreferences}
                    />
                  </div>
                </DropDrawerItem>
              </div>
            </TooltipTrigger>
            {!isSupportImageGeneration && (
              <TooltipContent>
                <p>This server doesn't support image generation</p>
              </TooltipContent>
            )}
          </Tooltip>
        )}

        {/* Temporary hide till we have connector */}
        {/* <DropDrawerSeparator />
        <DropDrawerItem>
          <div className="flex gap-2 items-center justify-between w-full">
            <div className="flex gap-2 items-center w-full">
              <ShapesIcon />
              <span>Connectors</span>
            </div>
          </div>
        </DropDrawerItem> */}
      </DropDrawerContent>
    </DropDrawer>
  )
}
