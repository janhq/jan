/**
 * WebSocket bridge utilities for communicating with the browser extension
 */
import { WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";
import { appendFileSync } from "fs";
const LOG_FILE = process.env.MCP_LOG_FILE;
const MAX_BRIDGE_RETRIES = 10;
const BRIDGE_RETRY_DELAY_MS = 100;
function logToFile(message) {
    if (LOG_FILE) {
        try {
            appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${message}\n`);
        }
        catch (e) { }
    }
}
function formatError(error) {
    if (error instanceof Error) {
        const stack = error.stack ? `\n${error.stack}` : "";
        return `${error.name}: ${error.message}${stack}`;
    }
    if (typeof error === "string") {
        return error;
    }
    try {
        return JSON.stringify(error);
    }
    catch (e) {
        return String(error);
    }
}
function logError(message, error) {
    if (error !== undefined) {
        logToFile(`ERROR: ${message}\n${formatError(error)}`);
    }
    else {
        logToFile(`ERROR: ${message}`);
    }
}
let extSocket = null;
const pendingCalls = new Map();
let activeTabId = null;
let isExtensionReady = false;
// Ping/Pong heartbeat configuration
const PING_INTERVAL_MS = 15000; // Send ping every 15 seconds
const PONG_TIMEOUT_MS = 5000; // Expect pong within 5 seconds
let pingInterval = null;
let pongTimeout = null;
let lastPongTime = Date.now();
// Exponential backoff retry configuration
const INITIAL_RETRY_DELAY_MS = 1000; // Start with 1s delay
const MAX_RETRY_DELAY_MS = 10000; // Cap at 10s delay
export function setActiveTabId(tabId) {
    activeTabId = tabId;
    logToFile(`Active tab set to: ${tabId}`);
}
export function getActiveTabId() {
    return activeTabId;
}
export function hasActiveTab() {
    return activeTabId !== null;
}
export function setExtensionSocket(socket) {
    extSocket = socket;
    // Reset ready state when socket changes
    if (!socket) {
        isExtensionReady = false;
    }
    // Start heartbeat when socket is set
    if (socket) {
        startHeartbeat();
    }
    else {
        stopHeartbeat();
    }
}
export function getExtensionSocket() {
    return extSocket;
}
export function hasExtensionConnection() {
    return extSocket !== null && extSocket.readyState === WebSocket.OPEN && isExtensionReady;
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function normalizeError(error) {
    if (error instanceof Error) {
        return error;
    }
    return new Error(typeof error === "string" ? error : String(error));
}
function isRetriableBridgeError(error) {
    const message = error.message || "";
    return (message.includes("not connected") ||
        message.includes("disconnected") ||
        message.includes("WebSocket is not open") ||
        message.includes("closed"));
}
/**
 * Start ping/pong heartbeat to keep connection alive
 */
function startHeartbeat() {
    stopHeartbeat(); // Clear any existing intervals
    lastPongTime = Date.now();
    pingInterval = setInterval(() => {
        if (!extSocket || extSocket.readyState !== WebSocket.OPEN) {
            logToFile("Heartbeat: Socket not open, stopping");
            stopHeartbeat();
            return;
        }
        // Check if we received a pong recently
        const timeSinceLastPong = Date.now() - lastPongTime;
        if (timeSinceLastPong > PING_INTERVAL_MS + PONG_TIMEOUT_MS) {
            logToFile(`Heartbeat: No pong received for ${timeSinceLastPong}ms, connection may be stale`);
            // Connection appears stale, close and let reconnection logic handle it
            try {
                extSocket.close();
            }
            catch (e) {
                logToFile(`Heartbeat: Error closing stale socket: ${e}`);
            }
            stopHeartbeat();
            return;
        }
        // Send ping
        try {
            logToFile("Heartbeat: Sending ping");
            extSocket.send(JSON.stringify({ kind: "ping" }));
            // Set timeout to check for pong
            if (pongTimeout)
                clearTimeout(pongTimeout);
            pongTimeout = setTimeout(() => {
                logToFile("Heartbeat: Pong timeout, connection may be unhealthy");
            }, PONG_TIMEOUT_MS);
        }
        catch (e) {
            logToFile(`Heartbeat: Error sending ping: ${e}`);
            stopHeartbeat();
        }
    }, PING_INTERVAL_MS);
    logToFile("Heartbeat: Started");
}
/**
 * Stop ping/pong heartbeat
 */
function stopHeartbeat() {
    if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
    }
    if (pongTimeout) {
        clearTimeout(pongTimeout);
        pongTimeout = null;
    }
    logToFile("Heartbeat: Stopped");
}
/**
 * Handle pong response from extension
 */
export function handlePong() {
    lastPongTime = Date.now();
    if (pongTimeout) {
        clearTimeout(pongTimeout);
        pongTimeout = null;
    }
    logToFile("Heartbeat: Received pong");
}
/**
 * Wait for the browser extension to connect to the bridge
 */
export async function waitForBridgeConnection(timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        const checkInterval = setInterval(() => {
            if (hasExtensionConnection()) {
                clearInterval(checkInterval);
                resolve();
            }
            else if (Date.now() - startTime > timeoutMs) {
                clearInterval(checkInterval);
                reject(new Error("Browser extension not connected to bridge"));
            }
        }, 100);
    });
}
/**
 * Call a tool on the browser extension via WebSocket bridge with retry logic and exponential backoff
 */
export async function callExtension(tool, params) {
    let attempts = 0;
    let lastError = null;
    while (attempts < MAX_BRIDGE_RETRIES) {
        if (!hasExtensionConnection()) {
            attempts++;
            lastError = new Error("Browser extension not connected to bridge");
            // Use exponential backoff for reconnection waits
            const delayMs = Math.min(INITIAL_RETRY_DELAY_MS * Math.pow(2, attempts - 1), MAX_RETRY_DELAY_MS);
            logToFile(`Retry ${attempts}/${MAX_BRIDGE_RETRIES}: Bridge not connected, waiting ${delayMs}ms...`);
            await delay(delayMs);
            continue;
        }
        try {
            return await sendToolCall(tool, params);
        }
        catch (error) {
            const normalized = normalizeError(error);
            lastError = normalized;
            if (!isRetriableBridgeError(normalized)) {
                logError(`Bridge call failed without retry for tool "${tool}"`, normalized);
                throw normalized;
            }
            attempts++;
            // Use exponential backoff for retryable errors
            const delayMs = Math.min(INITIAL_RETRY_DELAY_MS * Math.pow(2, attempts - 1), MAX_RETRY_DELAY_MS);
            logToFile(`Retry ${attempts}/${MAX_BRIDGE_RETRIES} for ${tool} after ${delayMs}ms (error: ${normalized.message})`);
            await delay(delayMs);
        }
    }
    const finalError = lastError || new Error("Browser extension not connected to bridge");
    logError(`Failed to call extension tool "${tool}" after ${attempts} attempts`, finalError);
    throw finalError;
}
function sendToolCall(tool, params) {
    return new Promise((resolve, reject) => {
        if (!hasExtensionConnection()) {
            reject(new Error("Browser extension not connected to bridge"));
            return;
        }
        const callId = uuidv4();
        // Increased timeout for long-running operations
        const timeoutMs = tool === "screenshot" ? 10000 : 60000; // Increased from 30s to 60s
        const timeout = setTimeout(() => {
            pendingCalls.delete(callId);
            const msg = `Tool call timeout after ${timeoutMs}ms: ${tool}`;
            logToFile(msg);
            reject(new Error(msg));
        }, timeoutMs);
        pendingCalls.set(callId, {
            resolve: (val) => {
                clearTimeout(timeout);
                logToFile(`Tool call resolved: ${tool} (${callId})`);
                resolve(val);
            },
            reject: (err) => {
                clearTimeout(timeout);
                logToFile(`Tool call rejected: ${tool} (${callId}) - ${err}`);
                reject(err);
            },
        });
        const message = {
            kind: "call",
            id: callId,
            tool: tool,
            params: params,
        };
        logToFile(`Sending to extension: ${tool} (${callId})`);
        try {
            extSocket.send(JSON.stringify(message));
        }
        catch (error) {
            clearTimeout(timeout);
            pendingCalls.delete(callId);
            const normalized = normalizeError(error);
            logError("Failed to send message to extension", normalized);
            reject(normalized);
        }
    });
}
/**
 * Handle incoming message from browser extension
 * Extension sends: {id, kind: "result", ok, data?, error?} or {kind: "pong"} or {kind: "ready"}
 */
export function handleExtensionMessage(data) {
    try {
        let msg;
        if (data && data.type === "Buffer" && Array.isArray(data.data)) {
            const buffer = Buffer.from(data.data);
            msg = JSON.parse(buffer.toString());
        }
        else if (typeof data === "string") {
            msg = JSON.parse(data);
        }
        else if (Buffer.isBuffer(data)) {
            msg = JSON.parse(data.toString());
        }
        else {
            msg = data;
        }
        logToFile(`Received from extension: ${JSON.stringify(msg)}`);
        if (msg.kind === "pong") {
            handlePong();
            return;
        }
        if (msg.kind === "ready") {
            isExtensionReady = true;
            logToFile("Extension handshake complete - bridge is ready");
            return;
        }
        if (msg.id && pendingCalls.has(msg.id)) {
            const { resolve, reject } = pendingCalls.get(msg.id);
            pendingCalls.delete(msg.id);
            if (msg.kind === "result") {
                if (msg.ok) {
                    logToFile(`Extension call succeeded: ${msg.id}`);
                    resolve(msg);
                }
                else {
                    logError("Extension call returned failure", msg.error);
                    reject(new Error(msg.error || "Extension call failed"));
                }
            }
            else {
                if (msg.error) {
                    reject(new Error(msg.error.message || String(msg.error)));
                }
                else {
                    resolve(msg.result || msg);
                }
            }
        }
    }
    catch (err) {
        logError("Error handling extension message", err);
    }
}
/**
 * Clean up pending calls when extension disconnects
 */
export function cleanupPendingCalls() {
    for (const [id, { reject }] of pendingCalls.entries()) {
        reject(new Error("Browser extension disconnected"));
    }
    pendingCalls.clear();
}
