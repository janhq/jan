import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useTranslation } from '@/i18n/react-i18next-compat'

interface ImageModalProps {
  image: { url: string; alt: string } | null
  onClose: () => void
}

const ImageModal = ({ image, onClose }: ImageModalProps) => {
  const { t } = useTranslation()

  return (
    <Dialog open={!!image} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] p-0">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle>{image?.alt || t('common:image')}</DialogTitle>
        </DialogHeader>
        <div className="flex justify-center items-center p-6 pt-2">
          {image && (
            <img
              src={image.url}
              alt={image.alt}
              className="max-w-full max-h-[70vh] object-contain rounded-md"
              onError={(e) => {
                e.currentTarget.style.display = 'none'
              }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default ImageModal
