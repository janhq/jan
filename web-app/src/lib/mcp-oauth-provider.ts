import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthTokens,
  OAuthClientInformation,
  OAuthClientMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { useAuth } from "@/stores/auth-store";

/**
 * MCP OAuth provider that integrates with Jan Auth Store
 * Provides tokens for MCP SDK authentication
 */
export class JanMCPOAuthProvider implements OAuthClientProvider {
  get redirectUrl(): string {
    return "";
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [], // Not used, but required by interface
    };
  }

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    return undefined;
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    try {
      const { accessToken } = useAuth.getState();
      if (accessToken) {
        return {
          access_token: accessToken,
          token_type: "Bearer",
        };
      }
    } catch (error) {
      console.warn("Failed to get tokens from auth store:", error);
    }
    return undefined;
  }

  async saveTokens(): Promise<void> {
    // No-op: Jan auth store handles token storage
  }

  redirectToAuthorization(): void {
    // No-op: Not handling authorization flow
  }

  async saveCodeVerifier(): Promise<void> {
    // No-op: Not handling authorization flow
  }

  async codeVerifier(): Promise<string> {
    throw new Error("Code verifier not supported");
  }
}
