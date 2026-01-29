export interface SessionInfo {
    pid: number;
    port: number;
    model_id: string;
    model_path: string;
    is_embedding: boolean;
    api_key: string;
}
export interface UnloadResult {
    success: boolean;
    error?: string;
}
export type MlxConfig = {
    ctx_size: number;
    n_predict: number;
    threads: number;
    chat_template: string;
};
