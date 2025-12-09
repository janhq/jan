import { Input } from '@/components/ui/input'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useAuth } from '@/stores/auth-store'
import { getInitialsAvatar } from '@/lib/utils'

export function GeneralSettings() {
  const user = useAuth((state) => state.user)

  return (
    <div>
      <p className="text-base font-medium mb-4">Account</p>
      {/* Profile Section */}
      <div className="flex items-center gap-4 mb-6 bg-muted/50 p-4 rounded-lg">
        <Avatar className="size-12">
          <AvatarImage src={user?.avatar} alt={user?.name} />
          <AvatarFallback className="bg-primary text-white text-xl font-semibold">
            {getInitialsAvatar(user?.name || '')}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 ">
          <h4 className="font-medium text-lg">{user?.name}</h4>
          <p className="text-xs text-muted-foreground">{user?.email}</p>
        </div>
      </div>

      {/* Personalization */}
      <div className="mb-6">
        <p className="text-base font-medium mb-4">Personalization</p>
        <FieldGroup>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel>What should Jan call you?</FieldLabel>
              <Input placeholder="Jan Doe" defaultValue={user?.name} />
            </Field>
            <Field>
              <FieldLabel>What do you do?</FieldLabel>
              <Input placeholder="Marketing Manager" />
            </Field>
          </div>
          <Field>
            <FieldLabel>Anything else Jan should know about you?</FieldLabel>
            <Input placeholder="I prefer short answers unless I ask for detail" />
          </Field>
        </FieldGroup>
      </div>
    </div>
  )
}
