import { Skeleton } from '@/components/ui/skeleton'

const MessageSkeleton = ({ isUser }: { isUser: boolean }) => (
  <div className={`flex gap-3 mb-6 ${isUser ? 'justify-end' : 'justify-start'}`}>
    <div className={`flex flex-col gap-2 ${isUser ? 'items-end' : 'items-start'}`}>
      <Skeleton className={`h-4 rounded ${isUser ? 'w-48' : 'w-64'}`} />
      <Skeleton className={`h-4 rounded ${isUser ? 'w-32' : 'w-80'}`} />
      {!isUser && <Skeleton className="h-4 w-56 rounded" />}
    </div>
  </div>
)

export const ThreadSkeleton = () => {
  return (
    <div className="flex flex-col py-4 animate-in fade-in duration-200">
      <MessageSkeleton isUser={true} />
      <MessageSkeleton isUser={false} />
      <MessageSkeleton isUser={false} />
    </div>
  )
}
