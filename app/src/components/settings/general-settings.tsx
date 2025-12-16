import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useAuth } from '@/stores/auth-store'
import { getInitialsAvatar } from '@/lib/utils'

export function GeneralSettings() {
  const user = useAuth((state) => state.user)

  return (
    <div>
      <p className="text-base font-medium mb-4 font-studio">Account</p>
      {/* Profile Section */}
      <div className="flex items-center gap-4 mb-6 bg-muted/50 p-4 rounded-lg">
        <Avatar className="size-12">
          <AvatarImage src={user?.avatar} alt={user?.name} />
          <AvatarFallback className="bg-primary text-background text-xl font-semibold">
            {getInitialsAvatar(user?.name || '')}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 ">
          <h4 className="font-medium text-lg">{user?.name}</h4>
          <p className="text-xs text-muted-foreground">{user?.email}</p>
        </div>
      </div>
    </div>
  )
}
