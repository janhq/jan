import {
  DropDrawer,
  DropDrawerContent,
  DropDrawerItem,
  DropDrawerSeparator,
  DropDrawerTrigger,
} from '@/components/ui/dropdrawer'
import { GlobeIcon, Leaf, MegaphoneIcon, ShapesIcon } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface SettingChatInputProps {
  searchEnabled: boolean
  deepResearchEnabled: boolean
  toggleSearch: () => void
  toggleDeepResearch: () => void
  isSupportTools: boolean
  isSupportDeepResearch: boolean
  children: React.ReactNode
}

export const SettingChatInput = ({
  searchEnabled,
  deepResearchEnabled,
  toggleSearch,
  toggleDeepResearch,
  isSupportTools,
  isSupportDeepResearch,
  children,
}: SettingChatInputProps) => {
  return (
    <DropDrawer>
      <DropDrawerTrigger asChild>{children}</DropDrawerTrigger>
      <DropDrawerContent align="start">
        <DropDrawerItem>
          <div className="flex gap-2 items-center justify-between w-full">
            <div className="flex gap-2 items-center w-full">
              <Leaf />
              <span>Tone</span>
            </div>
          </div>
        </DropDrawerItem>
        <Tooltip>
          <TooltipTrigger asChild>
            <div>
              <DropDrawerItem
                onSelect={(e) => e.preventDefault()}
                disabled={!isSupportTools}
              >
                <div className="flex gap-2 items-center justify-between w-full">
                  <div className="flex gap-2 items-center w-full">
                    <GlobeIcon />
                    <span>Search</span>
                  </div>
                  <Switch
                    checked={deepResearchEnabled ? true : searchEnabled}
                    onCheckedChange={toggleSearch}
                    disabled={!isSupportTools || deepResearchEnabled}
                  />
                </div>
              </DropDrawerItem>
            </div>
          </TooltipTrigger>
          {!isSupportTools && (
            <TooltipContent>
              <p>This model doesn't support search</p>
            </TooltipContent>
          )}
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <div>
              <DropDrawerItem
                onSelect={(e) => e.preventDefault()}
                disabled={!isSupportDeepResearch}
              >
                <div className="flex gap-2 items-center justify-between w-full">
                  <div className="flex gap-2 items-center w-full">
                    <MegaphoneIcon />
                    <span>Deep Research</span>
                  </div>
                  <Switch
                    checked={deepResearchEnabled}
                    onCheckedChange={toggleDeepResearch}
                    disabled={!isSupportDeepResearch}
                  />
                </div>
              </DropDrawerItem>
            </div>
          </TooltipTrigger>
          {!isSupportDeepResearch && (
            <TooltipContent>
              <p>This model doesn't support deep research</p>
            </TooltipContent>
          )}
        </Tooltip>
        <DropDrawerSeparator />
        <DropDrawerItem>
          <div className="flex gap-2 items-center justify-between w-full">
            <div className="flex gap-2 items-center w-full">
              <ShapesIcon />
              <span>Connectors</span>
            </div>
          </div>
        </DropDrawerItem>
      </DropDrawerContent>
    </DropDrawer>
  )
}
