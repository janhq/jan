import { signOut as signOutNextAuth } from 'next-auth/react'

export default function useSignOut() {
  const signOut = async () => {
    try {
      await fetch(`api/auth/logout`, { method: 'GET' })
      await signOutNextAuth({ callbackUrl: '/' })
    } catch (e) {
      console.error(e)
    }
  }

  return { signOut }
}
