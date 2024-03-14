import { useColorMode } from '@docusaurus/theme-common'
import { Tweet } from 'react-tweet'

const firstColumn = [
  {
    type: 'tweet',
    id: '1742843063938994469',
  },
  {
    type: 'youtube',
    id: 'ZCiEQVOjH5U',
  },
  {
    type: 'youtube',
    id: '7JpzE-_cKo4',
  },
  {
    type: 'tweet',
    id: '1744729548074459310',
  },
]

const secondColumn = [
  {
    type: 'youtube',
    id: 'QpMQgJL4AZA',
  },
  {
    type: 'tweet',
    id: '1750801065132384302',
  },
  {
    type: 'youtube',
    id: '9ta2S425Zu8',
  },
  {
    type: 'tweet',
    id: '1757504717519749292',
  },
]

const thirdColumn = [
  {
    type: 'tweet',
    id: '1745560583548670250',
  },
  {
    type: 'youtube',
    id: 'zkafOIyQM8s',
  },
  {
    type: 'tweet',
    id: '1757500111629025788',
  },
]

const fourthColumn = [
  {
    type: 'tweet',
    id: '1742993414986068423',
  },
  {
    type: 'youtube',
    id: '9ta2S425Zu8',
  },
  {
    type: 'youtube',
    id: 'ES021_sY6WQ',
  },
  {
    type: 'youtube',
    id: 'CbJGxNmdWws',
  },
]

const Testimonial = () => {
  const { colorMode } = useColorMode()

  return (
    <div className="bg-[#F0F0F0] dark:bg-[#242424] p-8 mt-10 pb-20">
      <div className="w-full xl:w-3/5 mx-auto relative py-8 text-center">
        <h1 className="text-5xl !font-normal leading-tight lg:leading-tight mt-2 font-serif">
          People say nice things
        </h1>
        <p className="leading-relaxed mt-2 text-black/60 dark:text-white/60">
          ...despite our bugs and fast moving releases
        </p>
      </div>
      <div className="w-full xl:w-3/4 mx-auto relative text-center">
        <div data-theme={colorMode} className="mt-10">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-left">
            <div className="space-y-4">
              {firstColumn.map((item, i) => {
                if (item.type === 'tweet') return <Tweet key={i} id={item.id} />
                if (item.type === 'youtube')
                  return (
                    <div>
                      <iframe
                        width="100%"
                        height="260"
                        src={`https://www.youtube.com/embed/${item.id}`}
                        title="Install Jan to Run LLM Offline and Local First"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowfullscreen
                        className="rounded-xl"
                      />
                    </div>
                  )
              })}
            </div>
            <div className="space-y-4">
              {secondColumn.map((item, i) => {
                if (item.type === 'tweet') return <Tweet key={i} id={item.id} />
                if (item.type === 'youtube')
                  return (
                    <div>
                      <iframe
                        width="100%"
                        height="260"
                        src={`https://www.youtube.com/embed/${item.id}`}
                        title="Install Jan to Run LLM Offline and Local First"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowfullscreen
                        className="rounded-xl"
                      />
                    </div>
                  )
              })}
            </div>
            <div className="space-y-4">
              {thirdColumn.map((item, i) => {
                if (item.type === 'tweet') return <Tweet key={i} id={item.id} />
                if (item.type === 'youtube')
                  return (
                    <div>
                      <iframe
                        width="100%"
                        height="260"
                        src={`https://www.youtube.com/embed/${item.id}`}
                        title="Install Jan to Run LLM Offline and Local First"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowfullscreen
                        className="rounded-xl"
                      />
                    </div>
                  )
              })}
            </div>
            <div className="space-y-4">
              {fourthColumn.map((item, i) => {
                if (item.type === 'tweet') return <Tweet key={i} id={item.id} />
                if (item.type === 'youtube')
                  return (
                    <div>
                      <iframe
                        width="100%"
                        height="260"
                        src={`https://www.youtube.com/embed/${item.id}`}
                        title="Install Jan to Run LLM Offline and Local First"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowfullscreen
                        className="rounded-xl"
                      />
                    </div>
                  )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Testimonial
