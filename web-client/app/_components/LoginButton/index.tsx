"use client";

import useGetCurrentUser from "@/_hooks/useGetCurrentUser";
import useSignIn from "@/_hooks/useSignIn";

const LoginButton: React.FC = () => {
  const { signInWithKeyCloak } = useSignIn();
  const { user, loading } = useGetCurrentUser();

  if (loading || user) {
    return <div />;
  }

  return (
    <div className="hidden lg:block">
      <button
        onClick={signInWithKeyCloak}
        type="button"
        className="rounded-md bg-indigo-600 px-2.5 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
      >
        Login
      </button>
    </div>
  );
};

export default LoginButton;
