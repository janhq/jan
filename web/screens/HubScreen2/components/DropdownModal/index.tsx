import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuPortal,
} from '@janhq/joi'

type Props = {
  trigger: React.ReactNode
  content: React.ReactNode
  className?: string
}

const DropdownModal: React.FC<Props> = ({ trigger, content, className }) => {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuContent align="end" className={className}>
          {content}
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenu>
  )
}
export default DropdownModal
