import { invoke } from '@tauri-apps/api/core';

function asNumber(v, defaultValue = 0) {
    if (v === '' || v === null || v === undefined)
        return defaultValue;
    const n = Number(v);
    return isFinite(n) ? n : defaultValue;
}
function asString(v, defaultValue = '') {
    if (v === '' || v === null || v === undefined)
        return defaultValue;
    return String(v);
}
function normalizeMlxConfig(config) {
    return {
        ctx_size: asNumber(config.ctx_size),
        n_predict: asNumber(config.n_predict),
        threads: asNumber(config.threads),
        chat_template: asString(config.chat_template),
    };
}
async function loadMlxModel(binaryPath, modelId, modelPath, port, cfg, envs, isEmbedding = false, timeout = 600) {
    const config = normalizeMlxConfig(cfg);
    return await invoke('plugin:mlx|load_mlx_model', {
        binaryPath,
        modelId,
        modelPath,
        port,
        config,
        envs,
        isEmbedding,
        timeout,
    });
}
async function unloadMlxModel(pid) {
    return await invoke('plugin:mlx|unload_mlx_model', { pid });
}
async function isMlxProcessRunning(pid) {
    return await invoke('plugin:mlx|is_mlx_process_running', { pid });
}
async function getMlxRandomPort() {
    return await invoke('plugin:mlx|get_mlx_random_port');
}
async function findMlxSessionByModel(modelId) {
    return await invoke('plugin:mlx|find_mlx_session_by_model', { modelId });
}
async function getMlxLoadedModels() {
    return await invoke('plugin:mlx|get_mlx_loaded_models');
}
async function getMlxAllSessions() {
    return await invoke('plugin:mlx|get_mlx_all_sessions');
}

export { findMlxSessionByModel, getMlxAllSessions, getMlxLoadedModels, getMlxRandomPort, isMlxProcessRunning, loadMlxModel, normalizeMlxConfig, unloadMlxModel };
