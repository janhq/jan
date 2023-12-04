declare const MODULE: string;
declare const INFERENCE_URL: string;

interface EngineSettings {
    ctx_len: number;
    ngl: number;
    cont_batching: boolean;
    embedding: boolean;
}