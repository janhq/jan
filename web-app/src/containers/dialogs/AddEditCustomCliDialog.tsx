import { useState, useEffect, useRef } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { IconPlus, IconTrash } from '@tabler/icons-react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import type { EnvVar } from '@/hooks/useClaudeCodeModel'

interface AddEditCustomCliProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialEnvVars?: EnvVar[]
  initialCustomCli?: string
  onSave: (envVars: EnvVar[], customCli: string) => void
}

export default function AddEditCustomCliDialog({
  open,
  onOpenChange,
  initialEnvVars = [],
  initialCustomCli = '',
  onSave,
}: AddEditCustomCliProps) {
  const { t } = useTranslation()
  const [envVars, setEnvVars] = useState<EnvVar[]>([{ key: '', value: '' }])
  const [customCli, setCustomCli] = useState('')
  const initialized = useRef(false)

  // Initialize once when dialog opens
  useEffect(() => {
    if (open && !initialized.current) {
      setEnvVars(initialEnvVars.length > 0 ? initialEnvVars : [{ key: '', value: '' }])
      setCustomCli(initialCustomCli || '')
      initialized.current = true
    }
  }, [open, initialEnvVars, initialCustomCli])

  // Reset initialized flag when dialog closes
  useEffect(() => {
    if (!open) {
      initialized.current = false
    }
  }, [open])

  const handleAddEnv = () => {
    setEnvVars([...envVars, { key: '', value: '' }])
  }

  const handleRemoveEnv = (index: number) => {
    const newEnvVars = [...envVars]
    newEnvVars.splice(index, 1)
    setEnvVars(newEnvVars.length > 0 ? newEnvVars : [{ key: '', value: '' }])
  }

  const handleEnvKeyChange = (index: number, value: string) => {
    setEnvVars((prev) => {
      const updated = [...prev]
      updated[index] = { ...updated[index], key: value }
      return updated
    })
  }

  const handleEnvValueChange = (index: number, value: string) => {
    setEnvVars((prev) => {
      const updated = [...prev]
      updated[index] = { ...updated[index], value: value }
      return updated
    })
  }

  const handleSave = () => {
    // Filter out empty env vars
    const filteredEnvVars = envVars
      .filter((env) => env.key.trim() !== '')
      .map((env) => ({ key: env.key.trim(), value: env.value.trim() }))

    onSave(filteredEnvVars, customCli.trim())
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        onInteractOutside={(e) => {
          e.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>Environment Variables</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Custom CLI Command */}
          {/* <div className="space-y-2">
            <label className="text-sm mb-2 inline-block">
              Command
            </label>
            <Input
              value={customCli}
              onChange={(e) => setCustomCli(e.target.value)}
              placeholder="Enter custom CLI command"
            />
          </div> */}

          {/* Environment Variables */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm">Environment Variables</label>
              <div
                className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-secondary transition-all duration-200 ease-in-out"
                onClick={handleAddEnv}
              >
                <IconPlus size={16} className="text-muted-foreground" />
              </div>
            </div>

            {envVars.map((env, index) => (
              <div key={`env-${index}`} className="flex items-center gap-2">
                <Input
                  value={env.key}
                  onChange={(e) => handleEnvKeyChange(index, e.target.value)}
                  placeholder="Key"
                  className="flex-1"
                />
                <Input
                  value={env.value}
                  onChange={(e) => handleEnvValueChange(index, e.target.value)}
                  placeholder="Value"
                  className="flex-1"
                />
                {envVars.length > 1 && (
                  <div
                    className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-secondary transition-all duration-200 ease-in-out"
                    onClick={() => handleRemoveEnv(index)}
                  >
                    <IconTrash size={16} className="text-destructive" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {t('common:cancel')}
          </Button>
          <Button
            onClick={() => {
              handleSave()
              onOpenChange(false)
            }}
            size="sm"
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
