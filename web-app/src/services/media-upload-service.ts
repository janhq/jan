import { fetchJsonWithAuth, fetchWithAuth } from "@/lib/api-client";

declare const JAN_API_BASE_URL: string;

// Response from the media upload API
export type MediaUploadResponse = {
  id: string;
  mime: string;
  bytes: number;
  deduped: boolean;
  presigned_url: string;
};

// Request payload for media upload
export type MediaUploadRequest = {
  source: {
    type: "data_url";
    data_url: string;
  };
  filename: string;
  user_id: string;
};

// Upload status for tracking
export type UploadStatus = "pending" | "uploading" | "completed" | "failed";

// Error type for upload failures
export type MediaUploadError = {
  code: "network" | "timeout" | "server" | "unknown";
  message: string;
};

/**
 * Convert a File to a base64 data URL
 */
export async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Failed to convert file to data URL"));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Convert a blob URL to a base64 data URL
 */
export async function blobUrlToDataUrl(blobUrl: string): Promise<string> {
  const response = await fetch(blobUrl);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Failed to convert blob to data URL"));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Upload media to the Jan API
 *
 * @param dataUrl - The base64 data URL of the file (e.g., "data:image/jpeg;base64,...")
 * @param filename - The original filename
 * @param userId - The user or conversation ID for tracking
 * @param abortSignal - Optional abort signal for cancellation
 * @returns MediaUploadResponse with the media ID and presigned URL
 */
export async function uploadMedia(
  dataUrl: string,
  filename: string,
  userId: string,
  abortSignal?: AbortSignal,
): Promise<MediaUploadResponse> {
  const payload: MediaUploadRequest = {
    source: {
      type: "data_url",
      data_url: dataUrl,
    },
    filename,
    user_id: userId,
  };

  return fetchJsonWithAuth<MediaUploadResponse>(
    `${JAN_API_BASE_URL}media/v1/media`,
    {
      method: "POST",
      body: JSON.stringify(payload),
      signal: abortSignal,
    },
  );
}

/**
 * Upload a File object directly
 *
 * @param file - The File object to upload
 * @param userId - The user or conversation ID for tracking
 * @param abortSignal - Optional abort signal for cancellation
 * @returns MediaUploadResponse with the media ID and presigned URL
 */
export async function uploadFile(
  file: File,
  userId: string,
  abortSignal?: AbortSignal,
): Promise<MediaUploadResponse> {
  const dataUrl = await fileToDataUrl(file);
  return uploadMedia(dataUrl, file.name, userId, abortSignal);
}

/**
 * Create the jan media URL format from a media ID and mime type
 * This format is used in chat messages instead of base64.
 * Uses data URL format with base64 marker so it passes standard data URL parsing.
 *
 * @param mediaId - The media ID returned from upload
 * @param mimeType - The MIME type (e.g., "image/jpeg")
 * @returns URL in format "data:image/jpeg;base64,jan_01kcnhmj1q9en1j553pdyswhns"
 */
export function createJanMediaUrl(mediaId: string, mimeType: string): string {
  return `data:${mimeType};base64,${mediaId}`;
}

/**
 * Check if a URL is a jan media URL format
 * Format: data:image/jpeg;base64,jan_MEDIA_ID
 * @param url - The URL to check
 * @returns true if the URL is a jan media URL
 */
export function isJanMediaUrl(url: string): boolean {
  return url.startsWith("data:") && url.includes(",jan_");
}

/**
 * Extract the media ID from a jan media URL
 * @param url - The jan media URL (e.g., "data:image/jpeg;base64,jan_01kcnhmj1q9en1j553pdyswhns")
 * @returns The media ID (e.g., "jan_01kcnhmj1q9en1j553pdyswhns") or null if not valid
 */
export function extractMediaIdFromUrl(url: string): string | null {
  if (!isJanMediaUrl(url)) return null;
  const match = url.match(/,(jan_[a-z0-9]+)$/);
  return match ? match[1] : null;
}

/**
 * Response from the presign API
 */
export type PresignResponse = {
  id: string;
  url: string;
  expires_in: number;
};

// Cache for presigned URLs to avoid repeated API calls
const presignedUrlCache = new Map<string, { url: string; expiresAt: number }>();

/**
 * Fetch media through the Jan API (proxy) and return a browser-safe URL.
 * This avoids direct S3 requests that can fail CORS in browsers.
 */
async function fetchMediaViaApi(mediaId: string): Promise<string> {
  const response = await fetchWithAuth(
    `${JAN_API_BASE_URL}media/v1/media/${mediaId}`,
    {
      method: "GET",
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch media via API: ${response.status}`);
  }

  const contentType = response.headers.get("Content-Type") || "";

  // If API returns JSON with a URL, use it directly
  if (contentType.includes("application/json")) {
    const json = await response.json();
    if (typeof json.url === "string" && json.url.length > 0) {
      return json.url;
    }
    throw new Error("Media API response missing url");
  }

  // Otherwise stream the blob and create an object URL
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

/**
 * Get a presigned URL for a jan media ID
 * This URL can be used to display the image in the browser
 *
 * @param mediaId - The jan media ID (e.g., "jan_01kcnhmj1q9en1j553pdyswhns")
 * @returns Promise<string> - The presigned URL for the image
 */
export async function getPresignedUrl(mediaId: string): Promise<string> {
  // Check cache first
  const cached = presignedUrlCache.get(mediaId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.url;
  }

  // Try fetching via API proxy first to avoid S3 CORS issues
  try {
    const apiUrl = await fetchMediaViaApi(mediaId);
    // Cache for 5 minutes for object URLs / API URLs
    presignedUrlCache.set(mediaId, {
      url: apiUrl,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
    return apiUrl;
  } catch (error) {
    console.warn(
      "Media proxy fetch failed, falling back to presigned URL:",
      error,
    );
  }

  const response = await fetchJsonWithAuth<PresignResponse>(
    `${JAN_API_BASE_URL}media/v1/media/${mediaId}/presign`,
    {
      method: "GET",
    },
  );

  // Cache the URL (expire 30 seconds before actual expiry for safety)
  const expiresAt = Date.now() + (response.expires_in - 30) * 1000;
  presignedUrlCache.set(mediaId, { url: response.url, expiresAt });

  return response.url;
}

/**
 * Convert a jan media URL to a presigned URL for display
 * @param janMediaUrl - The jan media URL (e.g., "data:image/jpeg;jan_01kcnhmj1q9en1j553pdyswhns")
 * @returns Promise<string> - The presigned URL for the image
 */
export async function resolveJanMediaUrl(janMediaUrl: string): Promise<string> {
  const mediaId = extractMediaIdFromUrl(janMediaUrl);
  if (!mediaId) {
    throw new Error("Invalid jan media URL");
  }
  return getPresignedUrl(mediaId);
}

export const mediaUploadService = {
  uploadMedia,
  uploadFile,
  fileToDataUrl,
  blobUrlToDataUrl,
  createJanMediaUrl,
  isJanMediaUrl,
  extractMediaIdFromUrl,
  getPresignedUrl,
  resolveJanMediaUrl,
};
