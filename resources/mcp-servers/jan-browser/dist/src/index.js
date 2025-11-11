/**
 * Jan Browser MCP Server
 * Modular architecture inspired by browsermcp
 * Provides browser automation tools via WebSocket bridge to Chrome extension
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { WebSocketServer } from "ws";
import { appendFileSync } from "node:fs";
// Bridge utilities
import { setExtensionSocket, handleExtensionMessage, cleanupPendingCalls, } from "./utils/bridge.js";
// Tool imports - organized by category
import * as automation from "./tools/automation.js";
import * as navigation from "./tools/navigation.js";
import * as observation from "./tools/observation.js";
// Configuration
let bridgeHost = process.env.BRIDGE_HOST || "127.0.0.1";
let bridgePort = Number(process.env.BRIDGE_PORT || 17389);
let bridgeToken = process.env.BRIDGE_TOKEN || undefined;
const SERVER_VERSION = "0.12.2";
const SERVER_NAME = "jan-browser-mcp";
// CLI arguments
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--bridge-host" || arg === "-H") {
        const value = args[i + 1];
        if (value) {
            bridgeHost = value;
            i++;
        }
    }
    else if (arg === "--bridge-port" || arg === "-p") {
        const value = args[i + 1];
        if (value) {
            const parsed = Number(value);
            if (!Number.isNaN(parsed) && parsed > 0 && parsed < 65536) {
                bridgePort = parsed;
            }
            i++;
        }
    }
    else if (arg === "--bridge-token") {
        const value = args[i + 1];
        if (value) {
            bridgeToken = value;
            i++;
        }
    }
    else if (arg === "--bridge-url") {
        const value = args[i + 1];
        if (value) {
            try {
                const parsed = new URL(value);
                bridgeHost = parsed.hostname || bridgeHost;
                if (parsed.port) {
                    const portNumber = Number(parsed.port);
                    if (!Number.isNaN(portNumber) && portNumber > 0 && portNumber < 65536) {
                        bridgePort = portNumber;
                    }
                }
                bridgeToken = parsed.searchParams.get("t") || bridgeToken;
            }
            catch (error) {
                logToFile(`Invalid --bridge-url provided: ${value} (${error.message})`);
            }
            i++;
        }
    }
}
// Optional file logging
const LOG_FILE = process.env.MCP_LOG_FILE;
// Helper to log without interfering with stdio transport
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
function logErrorToFile(message, error) {
    if (error !== undefined) {
        logToFile(`ERROR: ${message}\n${formatError(error)}`);
    }
    else {
        logToFile(`ERROR: ${message}`);
    }
}
// Log startup
logToFile(`jan-browser-mcp v${SERVER_VERSION} starting; bridge ws://${bridgeHost}:${bridgePort}`);
// Create MCP server using the old API like browsermcp
const server = new Server({
    name: SERVER_NAME,
    version: SERVER_VERSION,
}, {
    capabilities: {
        tools: {},
    },
});
// Collect all tools
const allTools = [
    // Automation tools
    automation.browserClick,
    automation.browserType,
    automation.browserHover,
    automation.browserSelectOption,
    automation.browserPressKey,
    automation.browserDrag,
    automation.browserFillForm,
    // Navigation tools
    navigation.browserNavigate,
    navigation.browserGoBack,
    navigation.browserGoForward,
    navigation.scroll,
    navigation.browserWait,
    // Observation tools
    observation.browserSnapshot,
    observation.browserScreenshot,
    observation.webSearch,
    observation.bridgeStatus,
];
// Register tool list handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: allTools.map((tool) => tool.schema) };
});
// Register tool execution handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = allTools.find((t) => t.schema.name === request.params.name);
    if (!tool) {
        logErrorToFile(`Tool "${request.params.name}" not found`);
        return {
            content: [
                { type: "text", text: `Tool "${request.params.name}" not found` },
            ],
            isError: true,
        };
    }
    try {
        const result = await tool.handle(request.params.arguments || {});
        return result;
    }
    catch (error) {
        logErrorToFile(`Tool "${request.params.name}" execution failed`, error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
            content: [{ type: "text", text: errorMessage }],
            isError: true,
        };
    }
});
// WebSocket bridge setup
const wss = new WebSocketServer({ host: bridgeHost, port: bridgePort });
wss.on("listening", () => {
    logToFile(`Bridge listening on ws://${bridgeHost}:${bridgePort}`);
});
wss.on("connection", (ws, req) => {
    // Token authentication
    if (bridgeToken) {
        const url = new URL(req.url || "/", `http://${req.headers.host}`);
        const token = url.searchParams.get("t");
        if (token !== bridgeToken) {
            logToFile("Bridge rejected connection: invalid token");
            ws.close(1008, "Invalid token");
            return;
        }
    }
    logToFile("Browser extension connected to MCP bridge");
    setExtensionSocket(ws);
    try {
        const handshake = {
            kind: "hello",
            serverVersion: SERVER_VERSION,
        };
        ws.send(JSON.stringify(handshake));
    }
    catch (error) {
        logToFile(`Failed to send handshake to extension: ${error.message}`);
    }
    ws.on("pong", () => {
        logToFile("Native WebSocket pong received");
    });
    ws.on("message", (data) => {
        handleExtensionMessage(data);
    });
    ws.on("close", () => {
        logToFile("Browser extension disconnected from MCP bridge");
        setExtensionSocket(null);
        cleanupPendingCalls();
    });
    ws.on("error", (err) => {
        logToFile(`WebSocket error: ${err.message}`);
    });
});
wss.on("error", (err) => {
    logErrorToFile("Failed to start WebSocket server", err);
    process.exit(1);
});
// Main function
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logToFile("MCP server ready, exposing tools via stdio");
}
// Run
main().catch((err) => {
    logErrorToFile("MCP server failed to start", err);
    process.exit(1);
});
