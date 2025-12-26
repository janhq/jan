import { Button } from '@/components/ui/button'
import { CloudIcon } from 'lucide-react'

export function PrivacySettings() {
  return (
    <div>
      <p className="text-base font-medium mb-2 font-studio">Privacy</p>
      <div className="flex justify-between items-center">
        <div className="bg-muted/50 p-4 rounded-md w-full">
          <div className="font-medium flex items-center gap-x-2">
            <CloudIcon />
            This is a cloud-hosted version of Jan
          </div>
          <p className="text-muted-foreground mt-2">
            That means your conversations and content are processed and stored
            on our servers, and may be used to improve the product. We work to
            protect your data and limit access. We use Google Analytics with
            standard, default tracking only.
          </p>
        </div>
      </div>
      <div className="text-muted-foreground mt-8 space-y-1">
        <div className="flex w-full justify-between items-center gap-x-4">
          <div>
            <p className="font-semibold text-foreground">
              Prefer full privacy?
            </p>
            <p className="text-xs mt-2">
              When you run Jan Desktop app, nothing is sent to the cloud by
              default
            </p>
          </div>
          <Button
            variant="secondary"
            className="rounded-full"
            size="sm"
            onClick={() => window.open('https://jan.ai', '_blank')}
          >
            Download App
          </Button>
        </div>
      </div>
    </div>
  )
}
