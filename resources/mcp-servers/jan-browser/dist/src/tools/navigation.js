/**
 * Browser navigation tools
 * Tools for navigating web pages, going back/forward, scrolling, etc.
 */
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { callExtension, waitForBridgeConnection, hasExtensionConnection } from "../utils/bridge.js";
import { captureAriaSnapshot } from "../utils/aria-snapshot.js";
const NavigateSchema = z.object({
    url: z.string().describe("The URL to navigate to"),
});
export const browserNavigate = {
    schema: {
        name: "browser_navigate",
        description: "Navigate to a URL",
        inputSchema: zodToJsonSchema(NavigateSchema),
    },
    handle: async (params) => {
        if (!hasExtensionConnection()) {
            await waitForBridgeConnection(4000);
        }
        let url = params.url;
        if (url && !url.match(/^https?:\/\//i)) {
            url = `https://${url}`;
        }
        const data = await callExtension("visit", { url, closeTab: false });
        return captureAriaSnapshot(data?.data?.url || url);
    },
};
const GoBackSchema = z.object({});
export const browserGoBack = {
    schema: {
        name: "browser_go_back",
        description: "Go back to the previous page",
        inputSchema: zodToJsonSchema(GoBackSchema),
    },
    handle: async () => {
        if (!hasExtensionConnection()) {
            await waitForBridgeConnection(4000);
        }
        const data = await callExtension("go_back", {});
        const snapshot = await captureAriaSnapshot(data?.data?.url);
        return withActionText("Navigated back", snapshot);
    },
};
const GoForwardSchema = z.object({});
export const browserGoForward = {
    schema: {
        name: "browser_go_forward",
        description: "Go forward to the next page",
        inputSchema: zodToJsonSchema(GoForwardSchema),
    },
    handle: async () => {
        if (!hasExtensionConnection()) {
            await waitForBridgeConnection(4000);
        }
        const data = await callExtension("go_forward", {});
        const snapshot = await captureAriaSnapshot(data?.data?.url);
        return withActionText("Navigated forward", snapshot);
    },
};
const ScrollSchema = z.object({
    direction: z.enum(["up", "down", "top", "bottom"]).describe("Scroll direction or position"),
    amount: z.number().optional().describe("Scroll amount in pixels (for 'up' and 'down' directions, default: 500)"),
});
export const scroll = {
    schema: {
        name: "scroll",
        description: "Scroll the page",
        inputSchema: zodToJsonSchema(ScrollSchema),
    },
    handle: async (params) => {
        if (!hasExtensionConnection()) {
            await waitForBridgeConnection(4000);
        }
        await callExtension("scroll_page", params);
        const snapshot = await captureAriaSnapshot();
        return withActionText(`Scrolled ${params.direction}`, snapshot);
    },
};
const WaitSchema = z.object({
    time: z.number().min(0.1).max(10).describe("The time to wait in seconds"),
});
export const browserWait = {
    schema: {
        name: "browser_wait",
        description: "Wait for a specified time in seconds",
        inputSchema: zodToJsonSchema(WaitSchema),
    },
    handle: async (params) => {
        const milliseconds = Math.min(params.time * 1000, 10000);
        await new Promise((resolve) => setTimeout(resolve, milliseconds));
        return {
            content: [
                {
                    type: "text",
                    text: `Waited for ${params.time} seconds`,
                },
            ],
        };
    },
};
function withActionText(action, snapshot) {
    const existing = Array.isArray(snapshot.content) ? snapshot.content : [];
    return {
        ...snapshot,
        content: [
            {
                type: "text",
                text: action,
            },
            ...existing,
        ],
    };
}
