import ExploreModelItem from '@/containers/ExploreModelItem'



export default function ExploreModelList(props: Props) {
  const { models } = props
  return (
    <div className="relative h-full w-full flex-shrink-0">
      {models?.map((item) => <ExploreModelItem key={item._id} model={item} />)}
    </div>
  )
}
