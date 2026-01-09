import { useResolvedMediaUrl as useResolvedMediaUrlBase } from "@janhq/interfaces/hooks/use-resolved-media-url";
import {
  isJanMediaUrl,
  resolveJanMediaUrl,
} from "@/services/media-upload-service";

/**
 * Hook to resolve Jan media URLs to displayable presigned URLs
 * This is a wrapper around the base hook that provides the app-specific resolvers
 *
 * @param url - The URL to resolve (can be jan media URL or regular URL)
 * @returns Object with displayUrl, isLoading state
 */
export function useResolvedMediaUrl(url: string | undefined) {
  return useResolvedMediaUrlBase(url, isJanMediaUrl, resolveJanMediaUrl);
}
