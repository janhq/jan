import Image from 'next/image'
type Props = {
  onTabClick: (clickedTab: 'description' | 'api') => void
  tab: string
}

export const TabModelDetail: React.FC<Props> = ({ onTabClick, tab }) => {
  const btns = [
    {
      name: 'api',
      icon: 'icons/unicorn_arrow.svg',
    },
    {
      name: 'description',
      icon: 'icons/unicorn_exclamation-circle.svg',
    },
  ]

  return (
    <div className="flex w-full gap-0.5 rounded bg-gray-200 p-1">
      {btns.map((item, index) => (
        <button
          key={index}
          onClick={() => onTabClick(item.name as 'description' | 'api')}
          className={`relative flex w-1/2 items-center justify-center gap-2 px-3 py-[6px] text-sm capitalize leading-5 ${
            tab !== item.name ? '' : 'rounded bg-white shadow-sm'
          }`}
        >
          <Image src={item.icon} width={20} height={20} alt="" />
          {item.name}
        </button>
      ))}
    </div>
  )
}
