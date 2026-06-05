import {
  OpenUILibraryRenderedContent,
  type OpenUIRenderedContentProps,
} from '@/containers/OpenUILibraryRenderedContent'
import { openuiLibrary } from '@openuidev/react-ui/genui-lib'
import '@openuidev/react-ui/defaults.css'
import '@openuidev/react-ui/components.css'

export function OpenUIStandardRenderedContent(
  props: OpenUIRenderedContentProps
) {
  return <OpenUILibraryRenderedContent {...props} library={openuiLibrary} />
}
