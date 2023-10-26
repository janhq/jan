import HeaderTitle from '../HeaderTitle'
import ExploreModelList from '../../../screens/ExploreModels/ExploreModelList'
import ExploreModelFilter from '../ExploreModelFilter'

const ExploreModelContainer: React.FC = () => (
  <div className="flex h-full w-full flex-1 flex-col px-16 pt-14">
    <HeaderTitle title="Explore Models" />
    {/* <SearchBar
      type={SearchType.Model}
      placeholder="Owner name like TheBloke, bhlim etc.."
    /> */}
    <div className="mt-9 flex flex-1 gap-x-10 overflow-hidden">
      <ExploreModelFilter />
      <ExploreModelList />
    </div>
  </div>
)

export default ExploreModelContainer
