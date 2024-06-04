import { Modal } from '@janhq/joi'
import { atom, useAtomValue } from 'jotai'

export type LoadingInfo = {
  title: string
  message: string
}

export const loadingModalInfoAtom = atom<LoadingInfo | undefined>(undefined)

const ResettingModal: React.FC = () => {
  const loadingInfo = useAtomValue(loadingModalInfoAtom)

  return (
    <Modal
      open={loadingInfo != null}
      title={loadingInfo?.title}
      content={
        <p className="text-[hsla(var(--text-secondary))]">
          {loadingInfo?.message}
        </p>
      }
    />
  )
}

export default ResettingModal
