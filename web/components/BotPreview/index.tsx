import Image from 'next/image'

const BotPreview: React.FC = () => {
  return (
    <div className="flex min-h-[235px] flex-col gap-2 overflow-hidden rounded-lg border border-gray-400 pb-2">
      <div className="flex items-center justify-center bg-gray-400 p-2">
        <Image
          className="rounded-md"
          src={
            'https://i.pinimg.com/564x/52/b1/6f/52b16f96f52221d48bea716795ccc89a.jpg'
          }
          width={32}
          height={32}
          alt=""
        />
      </div>
      <div className="flex items-center gap-1 px-1 text-xs text-gray-400">
        <div className="mx-1 flex-grow border-b border-gray-400"></div>
        Context cleared
        <div className="mx-1 flex-grow border-b border-gray-400"></div>
      </div>
    </div>
  )
}

export default BotPreview
