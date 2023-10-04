import { Task } from "./SearchModelParam.hf";

export type ListModelOutputHf = {
  id: string;
  name: string;
  private: boolean;
  task: Task;
  downloads: number;
  gated: boolean;
  likes: number;
  updatedAt?: number | null;

  files: Map<string, FileInfo>;
};

export type FileInfo = {
  type: string;
  oid: string;
  size: number;
  lfs: Map<string, unknown>;
  path: string;
  etag: string;
  downloadLink: string;
};
