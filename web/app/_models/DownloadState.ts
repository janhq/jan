/**
 * Represent the state of a download
 */
export type DownloadState = {
  modelId: string;
  time: DownloadTime;
  speed: number;
  percent: number;
  size: DownloadSize;
};

export type DownloadTime = {
  elapsed: number;
  remaining: number;
};

export type DownloadSize = {
  total: number;
  transferred: number;
};
