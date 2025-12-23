// import { Separator } from '@/components/ui/separator'
// import { Button } from '@/components/ui/button'
// import { Switch } from '@/components/ui/switch'
import { HatGlassesIcon, LockKeyhole, MessagesSquareIcon } from 'lucide-react'

export function PrivacySettings() {
  return (
    <div>
      <p className="text-base font-medium mb-2 font-studio">Privacy</p>
      <div className="flex justify-between items-center">
        <div>
          <div className="font-medium">Help Jan get better</div>
          <p className="text-muted-foreground mt-2">
            Sharing anonymous usage data helps us improve Jan.
          </p>
        </div>
        {/* <Switch /> */}
      </div>
      <div className="text-muted-foreground mt-2 space-y-1">
        <p className="font-semibold">Your privacy is protected:</p>
        <ul className="mt-2 space-y-1">
          <li className="flex items-center gap-2">
            <MessagesSquareIcon className="text-muted-foreground" />
            We don't collect your conversations
          </li>
          <li className="flex items-center gap-2">
            <LockKeyhole className="text-muted-foreground" />
            We don't collect personal data or files
          </li>
          <li className="flex items-center gap-2">
            <HatGlassesIcon className="text-muted-foreground" />
            Everything shared is anonymous and aggregated
          </li>
        </ul>
        <p className="text-sm mt-3 pt-3 border-t border-border">
          We use Google Analytics with standard default tracking only, no custom
          events, conversations, or personal data are collected.
        </p>
      </div>
    </div>
  )
}
