import { Switch } from '@/components/ui/switch'

// Checkbox or switch component
type CheckboxControlProps = {
  checked: boolean
  onChange: (checked: boolean) => void
}

export function CheckboxControl({ checked, onChange }: CheckboxControlProps) {
  return (
    <Switch checked={checked} onCheckedChange={(value) => onChange(value)} />
  )
}
