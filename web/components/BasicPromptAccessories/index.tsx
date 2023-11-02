'use client'

import SendButton from '../SendButton'

const BasicPromptAccessories: React.FC = () => {
  return (
    <div className="absolute inset-x-0 bottom-0 flex justify-between p-3">
      {/* Add future accessories here, e.g upload a file */}
      <div className="flex items-center space-x-5">
        <div className="flex items-center">
          {/* <button
            type="button"
            className="-m-2.5 flex h-10 w-10 items-center justify-center rounded-full text-gray-400 hover:text-gray-500"
          >
            <InformationCircleIcon className="h-5 w-5" aria-hidden="true" />
          </button> */}
        </div>
      </div>
      <div className="flex-shrink-0">
        <SendButton />
      </div>
    </div>
  )
}

export default BasicPromptAccessories
