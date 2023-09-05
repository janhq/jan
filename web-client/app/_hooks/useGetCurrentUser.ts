// @ts-nocheck
import { DefaultUser, User } from "@/_models/User";
import { Instance } from "mobx-state-tree";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import useSignOut from "./useSignOut";

export default function useGetCurrentUser() {
  const { data: session, status } = useSession();
  const { signOut } = useSignOut();
  const [loading, setLoading] = useState(status === "loading");
  const [user, setUser] = useState<Instance<typeof User>>();
  useEffect(() => {
    if (
      status !== "loading" &&
      session &&
      session?.error === "RefreshAccessTokenError"
    ) {
      signOut();
    }
  }, [session, status]);

  useEffect(() => {
    if (status === "loading") {
      setUser(undefined);
      setLoading(true);
      return;
    }
    if (status === "unauthenticated") {
      setUser(undefined);
      setLoading(false);
      return;
    }

    const tmp = {
      id: session?.user?.user_id ?? DefaultUser.id,
      displayName: session?.user?.name ?? DefaultUser.displayName,
      avatarUrl: session?.user?.image ?? DefaultUser.avatarUrl,
      email: session?.user?.email ?? DefaultUser.email,
    };

    setUser(tmp);
    setLoading(false);
  }, [status]);

  return { user, loading };
}
