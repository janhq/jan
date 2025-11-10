/**
 * Browser observation tools
 * Tools for capturing page state: snapshot, screenshot, web search, etc.
 */
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { callExtension, waitForBridgeConnection, hasExtensionConnection, setActiveTabId } from "../utils/bridge.js";
import { captureAriaSnapshot } from "../utils/aria-snapshot.js";
/**
 * Capture a comprehensive snapshot of the CURRENTLY ACTIVE TAB
 * Operates on whatever tab was opened with navigate_browser(closeTab=false)
 */
const SnapshotSchema = z.object({});
export const snapshot = {
    schema: {
        name: "snapshot",
        description: "Capture a comprehensive snapshot of the CURRENTLY ACTIVE TAB including: ARIA accessibility tree (roles, labels, interactive elements, landmarks), metadata, links, images, forms, headings, and viewport info. NO parameters needed - operates on the tab you opened with navigate_browser(closeTab=false). Perfect for understanding page structure before clicking/filling forms. Returns formatted YAML snapshot optimized for LLM context.",
        inputSchema: zodToJsonSchema(SnapshotSchema),
    },
    handle: async (params) => {
        if (!hasExtensionConnection()) {
            await waitForBridgeConnection(4000);
        }
        try {
            // Use the same captureAriaSnapshot helper that automation tools use
            // This provides a compact YAML format instead of large JSON
            return await captureAriaSnapshot(undefined, "Snapshot captured");
        }
        catch (err) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Snapshot failed: ${String(err?.message || err)}`,
                    },
                ],
                isError: true,
            };
        }
    },
};
/**
 * Capture a screenshot of the CURRENTLY ACTIVE TAB
 * Operates on whatever tab was opened with navigate_browser(closeTab=false)
 */
const ScreenshotSchema = z.object({});
export const screenshot = {
    schema: {
        name: "screenshot",
        description: "Capture a screenshot of the CURRENTLY ACTIVE TAB. NO parameters needed - captures whatever page you navigated to with navigate_browser(closeTab=false). Returns a base64-encoded PNG image. Use this to see what the page looks like visually.",
        inputSchema: zodToJsonSchema(ScreenshotSchema),
    },
    handle: async (params) => {
        if (!hasExtensionConnection()) {
            await waitForBridgeConnection(4000);
        }
        try {
            const data = await callExtension("screenshot", {});
            // Validate screenshot data exists and is not empty
            const screenshot = data?.data?.screenshot;
            if (!screenshot || typeof screenshot !== 'string' || screenshot.trim().length === 0) {
                return {
                    content: [
                        {
                            type: "text",
                            text: "Screenshot failed: No image data returned from browser. The page may not be accessible or the tab may have been closed.",
                        },
                    ],
                    isError: true,
                };
            }
            if (typeof data?.data?.tabId === "number") {
                setActiveTabId(data.data.tabId);
            }
            // Extract base64 data from data URL (remove "data:image/png;base64," prefix)
            // The screenshot from extension comes as: "data:image/png;base64,iVBORw0KGgo..."
            let base64Data = screenshot;
            let mimeType = "image/png";
            if (screenshot.startsWith("data:")) {
                const match = screenshot.match(/^data:([^;]+);base64,(.+)$/);
                if (match) {
                    mimeType = match[1];
                    base64Data = match[2];
                }
            }
            // Return image content using proper MCP protocol format
            // According to MCP specification, images should use type: "image" with base64 data
            return {
                content: [
                    {
                        type: "image",
                        data: base64Data,
                        mimeType: mimeType,
                    },
                ],
            };
        }
        catch (err) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Screenshot failed: ${String(err?.message || err)}`,
                    },
                ],
                isError: true,
            };
        }
    },
};
/**
 * Search the web using Google via the browser extension
 */
const WebSearchSchema = z.object({
    query: z.string().min(1).describe("The search query to execute"),
    numResults: z.number().min(1).max(10).optional().describe("Number of results (1-10, default: 5)"),
    format: z.enum(["serper", "text"]).optional().describe("Response format (default: serper)"),
});
export const webSearch = {
    schema: {
        name: "web_search",
        description: "Search the web via Google by asking the installed browser extension to perform the search and scrape the SERP. Returns search results with titles, URLs, snippets, and optionally knowledge graph and People Also Ask sections.",
        inputSchema: zodToJsonSchema(WebSearchSchema),
    },
    handle: async (params) => {
        if (!hasExtensionConnection()) {
            await waitForBridgeConnection(4000);
        }
        try {
            const data = await callExtension("search", params);
            // Format the search results
            const result = data.data;
            const format = params.format || "serper";
            if (format === "text") {
                let text = `Search results for: ${params.query}\n\n`;
                if (result.knowledgeGraph) {
                    const kg = result.knowledgeGraph;
                    text += `Knowledge Graph: ${kg.title || ""}\n${kg.description || ""}\n\n`;
                }
                if (result.organic?.length > 0) {
                    text += "Results:\n";
                    for (const item of result.organic) {
                        text += `\n${item.position}. ${item.title}\n`;
                        text += `   ${item.url}\n`;
                        if (item.snippet)
                            text += `   ${item.snippet}\n`;
                    }
                }
                if (result.peopleAlsoAsk?.length > 0) {
                    text += "\n\nPeople Also Ask:\n";
                    for (const paa of result.peopleAlsoAsk) {
                        text += `\nQ: ${paa.question}\n`;
                        text += `A: ${paa.snippet || ""}\n`;
                    }
                }
                return {
                    content: [{ type: "text", text }],
                    _meta: { urls: result.urls || [] },
                };
            }
            else {
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                    _meta: { urls: result.urls || [] },
                };
            }
        }
        catch (err) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Search failed: ${String(err?.message || err)}`,
                    },
                ],
                isError: true,
            };
        }
    },
};
/**
 * Get current browser status
 */
const BridgeStatusSchema = z.object({});
export const bridgeStatus = {
    schema: {
        name: "bridge_status",
        description: "Check if the browser extension is connected to the MCP bridge.",
        inputSchema: zodToJsonSchema(BridgeStatusSchema),
    },
    handle: async () => {
        const connected = hasExtensionConnection();
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ connected, timestamp: new Date().toISOString() }),
                },
            ],
        };
    },
};
