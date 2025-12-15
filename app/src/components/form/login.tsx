import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuth } from '@/stores/auth-store'
import { useRouter } from '@tanstack/react-router'
import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Google } from '@/components/ui/svgs/google'
import { buildGoogleAuthUrl } from '@/lib/oauth'
import { useState } from 'react'

const loginSchema = z.object({
  email: z.email({ error: 'Please enter a valid email address' }),
  password: z.string().min(6, 'Password must be at least 6 characters'),
})

type LoginFormData = z.infer<typeof loginSchema>

export function LoginForm({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  const login = useAuth((state) => state.login)
  const router = useRouter()
  const [isGoogleLoading, setIsGoogleLoading] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  })

  const onSubmit = async (data: LoginFormData) => {
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1000))

    // Mock login - replace with actual API call
    login({
      id: '1',
      name: 'John Doe',
      email: data.email,
      avatar: '',
      pro: false,
    })

    // Remove modal param from URL
    const url = new URL(window.location.href)
    url.searchParams.delete('modal')
    router.navigate({ to: url.pathname + url.search })
  }

  const handleGoogleLogin = async () => {
    try {
      setIsGoogleLoading(true)

      // Store the current URL to redirect back after OAuth
      const currentUrl = window.location.pathname + window.location.search

      // Build Keycloak authorization URL with Google IdP
      const authUrl = await buildGoogleAuthUrl(currentUrl)
      // Redirect to Keycloak for Google OAuth
      window.location.href = authUrl
    } catch (error) {
      console.error('Google login error:', error)
      setIsGoogleLoading(false)
      // TODO: Show error toast to user
    }
  }

  return (
    <div className={cn('flex flex-col gap-3', className)} {...props}>
      <DialogHeader className="mb-2">
        <DialogTitle>Login to your account</DialogTitle>
        <DialogDescription>
          Enter your email below to login to your account
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit(onSubmit)}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              type="email"
              placeholder="example@company.com"
              {...register('email')}
            />
            {errors.email && <FieldError>{errors.email.message}</FieldError>}
          </Field>
          <Field>
            <div className="flex items-center">
              <FieldLabel htmlFor="password">Password</FieldLabel>
            </div>
            <Input
              id="password"
              type="password"
              placeholder="Your Password"
              {...register('password')}
            />
            {errors.password && (
              <FieldError>{errors.password.message}</FieldError>
            )}
          </Field>
          <Field>
            <Button type="submit" disabled={isSubmitting || isGoogleLoading}>
              {isSubmitting ? 'Loading...' : 'Continue'}
            </Button>
            <Button
              variant="outline"
              type="button"
              onClick={handleGoogleLogin}
              disabled={isSubmitting || isGoogleLoading}
            >
              <Google className="size-4" />
              {isGoogleLoading ? 'Redirecting...' : 'Continue with Google'}
            </Button>
            <FieldDescription className="text-center">
              Don&apos;t have an account? <a href="/">Sign up</a>
            </FieldDescription>
          </Field>
        </FieldGroup>
      </form>
    </div>
  )
}
