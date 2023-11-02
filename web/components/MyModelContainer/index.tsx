import ActiveModelTable from '../ActiveModelTable'
import DownloadedModelTable from '../DownloadedModelTable'
import DownloadingModelTable from '../DownloadingModelTable'
import HeaderTitle from '../HeaderTitle'

const MyModelContainer: React.FC = () => (
  <div className="flex flex-1 flex-col pt-[60px]">
    <HeaderTitle title="My Models" className="pl-[63px] pr-[89px]" />
    <div className="scroll overflow-y-auto pb-6">
      <ActiveModelTable />
      <DownloadingModelTable />
      <DownloadedModelTable />
    </div>
  </div>
)

export default MyModelContainer
