import InputToolbar from '../InputToolbar'
import SelectModels from '../ModelSelector'

const EmptyChatContainer: React.FC = () => (
  <div className="flex h-full w-full flex-1 flex-col">
    <div className="flex flex-1 items-center justify-center">
      <SelectModels />
    </div>
    <InputToolbar />
  </div>
)

export default EmptyChatContainer
