import { memo } from 'react'

import { Loader } from 'lucide-react'

const LoadingIndicator: React.FC = () => {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <Loader className="animate-spin" size={25} />
    </div>
  )
}
export default memo(LoadingIndicator)
