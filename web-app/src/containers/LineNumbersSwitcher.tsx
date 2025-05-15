import { useCodeblock } from '@/hooks/useCodeblock'
import { Switch } from '@/components/ui/switch'

export function LineNumbersSwitcher() {
  const { showLineNumbers, setShowLineNumbers } = useCodeblock()

  const toggleLineNumbers = () => {
    setShowLineNumbers(!showLineNumbers)
  }

  return (
    <Switch checked={showLineNumbers} onCheckedChange={toggleLineNumbers} />
  )
}
