import { signOut as signOutNextAuth } from "next-auth/react";

export default function useSignOut() {
  const signOut = () => {
    fetch(`api/auth/logout`, { method: "GET" })
      .then(() => signOutNextAuth({ callbackUrl: "/" }))
      .catch((e) => {
        console.error(e);
      });
  };

  return { signOut };
}
