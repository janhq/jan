/**
 * Tools for interacting with web pages: click, type, hover, drag, fill forms, etc.
 */
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { callExtension, waitForBridgeConnection, hasExtensionConnection } from "../utils/bridge.js";
import { captureAriaSnapshot } from "../utils/aria-snapshot.js";
/**
 * Click an element on the page by CSS selector
 */
const ClickSchema = z.object({
    selector: z.string().describe("CSS selector for the element to click (e.g., '#submit-btn', '.nav-link', 'button[type=\"submit\"]')"),
    waitForNavigation: z.boolean().optional().describe("Whether to wait for navigation after clicking (default: true)"),
});
export const click = {
    schema: {
        name: "click",
        description: "Click an element on the currently active tab using a CSS selector. First use navigate_browser to load a page, then use this tool to interact with elements. Returns snapshot of the page after clicking.",
        inputSchema: zodToJsonSchema(ClickSchema),
    },
    handle: async (params) => {
        if (!hasExtensionConnection()) {
            await waitForBridgeConnection(4000);
        }
        const data = await callExtension("click_element", params);
        // Return snapshot after clicking
        return captureAriaSnapshot(data.data.finalUrl, `Clicked "${params.selector}"`);
    },
};
/**
 * Type text into an element
 */
const TypeSchema = z.object({
    selector: z.string().describe("CSS selector for the input element"),
    text: z.string().describe("Text to type into the element"),
    clear: z.boolean().optional().describe("Whether to clear existing text before typing (default: true)"),
    pressEnter: z.boolean().optional().describe("Whether to press Enter after typing (useful for submitting forms or sending messages, default: false)"),
});
export const type = {
    schema: {
        name: "type",
        description: "Type text into a form field or input element on the currently active tab. Supports regular inputs, textareas, and contenteditable elements (like Slack, Discord). First use navigate_browser to load a page, then use this tool to interact with elements. Set pressEnter=true to submit forms or send messages after typing.",
        inputSchema: zodToJsonSchema(TypeSchema),
    },
    handle: async (params) => {
        if (!hasExtensionConnection()) {
            await waitForBridgeConnection(4000);
        }
        const data = await callExtension("type_text", params);
        const action = params.pressEnter ? `Typed "${params.text}" and pressed Enter` : `Typed "${params.text}"`;
        return captureAriaSnapshot(data.data.url, `${action} into "${params.selector}"`);
    },
};
/**
 * Hover over an element
 */
const HoverSchema = z.object({
    selector: z.string().describe("CSS selector for the element to hover over"),
});
export const hover = {
    schema: {
        name: "hover",
        description: "Hover the mouse over an element on the currently active tab to trigger hover effects, tooltips, or dropdowns. First use navigate_browser to load a page, then use this tool to interact with elements.",
        inputSchema: zodToJsonSchema(HoverSchema),
    },
    handle: async (params) => {
        if (!hasExtensionConnection()) {
            await waitForBridgeConnection(4000);
        }
        const data = await callExtension("hover_element", params);
        return captureAriaSnapshot(data.data.url, `Hovered over "${params.selector}"`);
    },
};
/**
 * Select an option from a dropdown
 */
const SelectOptionSchema = z.object({
    selector: z.string().describe("CSS selector for the select element"),
    value: z.string().describe("The option value or visible text to select"),
});
export const selectOption = {
    schema: {
        name: "select_option",
        description: "Select an option from a dropdown/select element on the currently active tab by value or visible text. First use navigate_browser to load a page, then use this tool to interact with elements.",
        inputSchema: zodToJsonSchema(SelectOptionSchema),
    },
    handle: async (params) => {
        if (!hasExtensionConnection()) {
            await waitForBridgeConnection(4000);
        }
        const data = await callExtension("select_option", params);
        return captureAriaSnapshot(data.data.url, `Selected option "${params.value}" in "${params.selector}"`);
    },
};
/**
 * Fill multiple form fields at once
 */
const FillFormFieldSchema = z.object({
    selector: z.string().describe("CSS selector for the form field"),
    value: z.string().describe("Value to set (use 'true'/'false' for checkboxes)"),
});
const FillFormSchema = z.object({
    fields: z.array(FillFormFieldSchema).min(1).describe("Array of fields to fill"),
});
export const fillForm = {
    schema: {
        name: "fill_form",
        description: "Fill multiple form fields at once on the currently active tab. First use navigate_browser to load a page, then use this tool to interact with elements. Supports text inputs, selects, checkboxes, and radio buttons.",
        inputSchema: zodToJsonSchema(FillFormSchema),
    },
    handle: async (params) => {
        if (!hasExtensionConnection()) {
            await waitForBridgeConnection(4000);
        }
        const data = await callExtension("fill_form", params);
        const fieldCount = data.data.successfulFields || 0;
        return captureAriaSnapshot(data.data.url, `Filled ${fieldCount} form fields`);
    },
};
/**
 * Execute custom JavaScript on the page
 */
const ExecuteScriptSchema = z.object({
    script: z.string().describe("The JavaScript code to execute. Should be a function body that returns a value."),
    args: z.array(z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.null(),
        z.record(z.unknown()),
    ])).optional().describe("Optional array of arguments to pass to the script (supports strings, numbers, booleans, null, and objects)"),
});
export const executeScript = {
    schema: {
        name: "execute_script",
        description: "Execute custom JavaScript code on the currently active tab and return the result. First use navigate_browser to load a page, then use this tool to execute scripts. Use with caution.",
        inputSchema: zodToJsonSchema(ExecuteScriptSchema),
    },
    handle: async (params) => {
        if (!hasExtensionConnection()) {
            await waitForBridgeConnection(4000);
        }
        const data = await callExtension("execute_script", params);
        return {
            content: [
                {
                    type: "text",
                    text: `Script executed successfully on ${data.data.url}. Result:\n\`\`\`json\n${JSON.stringify(data.data.result, null, 2)}\n\`\`\``,
                },
            ],
            _meta: { urls: [data.data.url] },
        };
    },
};
