/**
 * Manual Capability Override UI Component
 * Allows users to manually enable/disable model capabilities
 */

import { useState, useEffect } from 'react'
import { capabilityOverrideService } from '@/services/models/capability-overrides'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { IconAlertCircle } from '@tabler/icons-react'

interface CapabilityOverrideUIProps {
  modelId: string
  currentCapabilities: string[]
  onUpdate?: (capabilities: string[]) => void
}

const AVAILABLE_CAPABILITIES = [
  {
    id: 'tools',
    label: 'Tool Calling',
    description: 'Enable function calling and tool use',
  },
  {
    id: 'vision',
    label: 'Vision',
    description: 'Enable image understanding capabilities',
  },
  {
    id: 'json_mode',
    label: 'JSON Mode',
    description: 'Enable structured JSON output',
  },
]

export function CapabilityOverrideUI({
  modelId,
  currentCapabilities,
  onUpdate,
}: CapabilityOverrideUIProps) {
  const [capabilities, setCapabilities] =
    useState<string[]>(currentCapabilities)
  const [hasOverride, setHasOverride] = useState(false)

  useEffect(() => {
    const override = capabilityOverrideService.getOverride(modelId)
    if (override) {
      setCapabilities(override.capabilities)
      setHasOverride(true)
    } else {
      setCapabilities(currentCapabilities)
      setHasOverride(false)
    }
  }, [modelId, currentCapabilities])

  const handleToggle = (capabilityId: string) => {
    const newCapabilities = capabilityOverrideService.toggleCapability(
      modelId,
      capabilityId,
      capabilities
    )
    setCapabilities(newCapabilities)
    setHasOverride(true)
    onUpdate?.(newCapabilities)
  }

  const handleReset = () => {
    capabilityOverrideService.removeOverride(modelId)
    setCapabilities(currentCapabilities)
    setHasOverride(false)
    onUpdate?.(currentCapabilities)
  }

  return (
    <div className="space-y-4 p-4 border border-main-view-fg/10 rounded-lg">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-medium">Manual Capability Override</h3>
          <p className="text-sm text-main-view-fg/60 mt-1">
            Override detected capabilities for this model
          </p>
        </div>
        {hasOverride && (
          <button
            onClick={handleReset}
            className="text-xs text-accent hover:underline"
          >
            Reset to Auto
          </button>
        )}
      </div>

      {hasOverride && (
        <div className="flex items-start gap-2 p-2 bg-yellow-500/10 border border-yellow-500/20 rounded text-xs">
          <IconAlertCircle
            size={16}
            className="text-yellow-500 mt-0.5 flex-shrink-0"
          />
          <p className="text-yellow-500">
            Manual overrides active. Capabilities may not match model's actual
            support.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {AVAILABLE_CAPABILITIES.map((capability) => (
          <div
            key={capability.id}
            className="flex items-start justify-between gap-4 py-2"
          >
            <div className="flex-1">
              <Label htmlFor={`cap-${capability.id}`} className="font-medium">
                {capability.label}
              </Label>
              <p className="text-xs text-main-view-fg/60 mt-0.5">
                {capability.description}
              </p>
            </div>
            <Switch
              id={`cap-${capability.id}`}
              checked={capabilities.includes(capability.id)}
              onCheckedChange={() => handleToggle(capability.id)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
