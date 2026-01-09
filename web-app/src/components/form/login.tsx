import { cn } from "@/lib/utils";
import { Button } from "@janhq/interfaces/button";
import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@janhq/interfaces/dialog";
import { Google } from "@janhq/interfaces/svgs/google";
import { buildGoogleAuthUrl } from "@/lib/oauth";
import { useState } from "react";

export function LoginForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  const handleGoogleLogin = async () => {
    try {
      setIsGoogleLoading(true);

      // Store the current URL to redirect back after OAuth
      const currentUrl = window.location.pathname + window.location.search;

      // Build Keycloak authorization URL with Google IdP
      const authUrl = await buildGoogleAuthUrl(currentUrl);
      // Redirect to Keycloak for Google OAuth
      window.location.href = authUrl;
    } catch (error) {
      console.error("Google login error:", error);
      setIsGoogleLoading(false);
      // TODO: Show error toast to user
    }
  };

  return (
    <div className={cn("flex flex-col gap-3", className)} {...props}>
      <DialogHeader className="mb-2 text-left">
        <DialogTitle>Login to your account</DialogTitle>
        <DialogDescription>
          Sign in with your Google account to continue
        </DialogDescription>
      </DialogHeader>
      <Button
        variant="outline"
        type="button"
        onClick={handleGoogleLogin}
        disabled={isGoogleLoading}
      >
        <Google className="size-4" />
        {isGoogleLoading ? "Redirecting..." : "Continue with Google"}
      </Button>
    </div>
  );
}
