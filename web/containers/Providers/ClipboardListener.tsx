import { useSetAtom } from 'jotai'

import { selectedTextAtom } from './Jotai'

const ClipboardListener: React.FC = () => {
  const setSelectedText = useSetAtom(selectedTextAtom)

  if (typeof window !== 'undefined') {
    window?.electronAPI?.onSelectedText((_event: string, text: string) => {
      setSelectedText(text)
    })
  }

  return null
}

export default ClipboardListener
