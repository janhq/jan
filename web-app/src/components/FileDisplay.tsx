import { IconX, IconVolume } from '@tabler/icons-react'
import { cn, toGigabytes } from '@/lib/utils'
import type { SupportedFileType } from '@/utils/fileUtils'

type FileDisplayProps = {
  files: SupportedFileType[]
  onRemoveFile: (index: number) => void
}

const FileDisplay = ({ files, onRemoveFile }: FileDisplayProps) => {
  if (files.length === 0) return null

  return (
    <div className="flex gap-3 items-center p-2 pb-0">
      {files.map((file, index) => (
        <FileItem
          key={file.name}
          file={file}
          index={index}
          onRemove={onRemoveFile}
        />
      ))}
    </div>
  )
}

type FileItemProps = {
  file: SupportedFileType
  index: number
  onRemove: (index: number) => void
}

const FileItem = ({ file, index, onRemove }: FileItemProps) => {
  const isImage = file.type.startsWith('image/')
  const isAudio = file.type.startsWith('audio/')
  const isDocument =
    file.type === 'application/pdf' ||
    file.type === 'application/msword' ||
    file.type ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    file.type === 'text/plain'

  return (
    <div
      className={cn(
        'relative border border-main-view-fg/5 rounded-lg',
        isImage ? 'size-14' : 'h-14'
      )}
    >
      {/* Image Preview */}
      {isImage && (
        <img
          className="object-cover w-full h-full rounded-lg"
          src={file.dataUrl}
          alt={`${file.name} - ${index}`}
        />
      )}

      {/* Audio Display */}
      {isAudio && <AudioFileDisplay file={file} />}

      {/* Document Display */}
      {isDocument && <DocumentFileDisplay file={file} />}

      {/* Remove Button */}
      <RemoveButton onRemove={() => onRemove(index)} />
    </div>
  )
}

const AudioFileDisplay = ({ file }: { file: SupportedFileType }) => (
  <div className="bg-main-view-fg/4 h-full rounded-lg p-2 max-w-[400px] pr-4">
    <div className="flex gap-2 items-center justify-center h-full">
      <div className="size-10 rounded-md bg-main-view shrink-0 flex items-center justify-center">
        <IconVolume size={20} className="text-main-view-fg" />
      </div>
      <div className="truncate">
        <h6 className="truncate mb-0.5 text-main-view-fg/80">{file.name}</h6>
        <p className="text-xs text-main-view-fg/70">
          {toGigabytes(file.size)} • {file.type.split('/')[1].toUpperCase()}
        </p>
      </div>
    </div>
  </div>
)

const DocumentFileDisplay = ({ file }: { file: SupportedFileType }) => (
  <div className="bg-main-view-fg/4 h-full rounded-lg p-2 max-w-[400px] pr-4">
    <div className="flex gap-2 items-center justify-center h-full">
      <div className="size-10 rounded-md bg-main-view shrink-0 flex items-center justify-center">
        <span className="uppercase font-bold text-xs">
          {file.name.split('.').pop()}
        </span>
      </div>
      <div className="truncate">
        <h6 className="truncate mb-0.5 text-main-view-fg/80">{file.name}</h6>
        <p className="text-xs text-main-view-fg/70">{toGigabytes(file.size)}</p>
      </div>
    </div>
  </div>
)

const RemoveButton = ({ onRemove }: { onRemove: () => void }) => (
  <div
    className="absolute -top-1 -right-2.5 bg-destructive size-5 flex rounded-full items-center justify-center cursor-pointer"
    onClick={onRemove}
  >
    <IconX className="text-destructive-fg" size={16} />
  </div>
)

export default FileDisplay
