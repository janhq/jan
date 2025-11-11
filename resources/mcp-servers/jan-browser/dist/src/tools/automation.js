/**
 * Tools for interacting with web pages: click, type, hover, drag, etc.
 */
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { callExtension, waitForBridgeConnection, hasExtensionConnection } from "../utils/bridge.js";
import { captureAriaSnapshot } from "../utils/aria-snapshot.js";
const ElementSchema = z.object({
    element: z.string().describe("Human-readable element description from the browser snapshot"),
    ref: z.string().describe("Exact target element reference from the browser snapshot"),
    selector: z
        .string()
        .optional()
        .describe("Optional CSS selector fallback (legacy). Use ref from browser_snapshot whenever possible."),
});
const ClickSchema = ElementSchema;
export const browserClick = {
    schema: {
        name: "browser_click",
        description: "Perform click on a web page",
        inputSchema: zodToJsonSchema(ClickSchema),
    },
    handle: async (params) => {
        if (!hasExtensionConnection()) {
            await waitForBridgeConnection(4000);
        }
        await callExtension("click_element", params);
        const snapshot = await captureAriaSnapshot();
        return withActionText(`Clicked "${params.element}"`, snapshot);
    },
};
const TypeSchema = ElementSchema.extend({
    text: z.string().describe("Text to type into the element"),
    submit: z.boolean().optional().describe("Whether to submit entered text (press Enter after)"),
});
export const browserType = {
    schema: {
        name: "browser_type",
        description: "Type text into editable element",
        inputSchema: zodToJsonSchema(TypeSchema),
    },
    handle: async (params) => {
        if (!hasExtensionConnection()) {
            await waitForBridgeConnection(4000);
        }
        await callExtension("type_text", { ...params, pressEnter: params.submit === true });
        const action = params.submit ? `Typed "${params.text}" and pressed Enter` : `Typed "${params.text}"`;
        const snapshot = await captureAriaSnapshot();
        return withActionText(`${action} into "${params.element}"`, snapshot);
    },
};
const HoverSchema = ElementSchema;
export const browserHover = {
    schema: {
        name: "browser_hover",
        description: "Hover over element on page",
        inputSchema: zodToJsonSchema(HoverSchema),
    },
    handle: async (params) => {
        if (!hasExtensionConnection()) {
            await waitForBridgeConnection(4000);
        }
        await callExtension("hover_element", params);
        const snapshot = await captureAriaSnapshot();
        return withActionText(`Hovered over "${params.element}"`, snapshot);
    },
};
const SelectOptionSchema = ElementSchema.extend({
    values: z.array(z.string()).min(1).describe("Array of values to select in the dropdown"),
});
export const browserSelectOption = {
    schema: {
        name: "browser_select_option",
        description: "Select an option in a dropdown",
        inputSchema: zodToJsonSchema(SelectOptionSchema),
    },
    handle: async (params) => {
        if (!hasExtensionConnection()) {
            await waitForBridgeConnection(4000);
        }
        await callExtension("select_option", params);
        const snapshot = await captureAriaSnapshot();
        return withActionText(`Selected option in "${params.element}"`, snapshot);
    },
};
const FillFormFieldSchema = z.object({
    selector: z
        .string()
        .optional()
        .describe("CSS selector for the form field (legacy fallback, prefer ref)"),
    ref: z.string().optional().describe("Element reference from browser_snapshot"),
    value: z.string().describe("Value to set (use 'true'/'false' for checkboxes)"),
});
const FillFormSchema = z.object({
    fields: z.array(FillFormFieldSchema).min(1).describe("Array of fields to fill"),
});
export const browserFillForm = {
    schema: {
        name: "browser_fill_form",
        description: "Fill multiple form fields (inputs, selects, checkboxes, radios) by selector/value.",
        inputSchema: zodToJsonSchema(FillFormSchema),
    },
    handle: async (params) => {
        if (!hasExtensionConnection()) {
            await waitForBridgeConnection(4000);
        }
        const data = await callExtension("browser_fill_form", params);
        const fieldCount = data?.data?.successfulFields || params.fields.length;
        const snapshot = await captureAriaSnapshot();
        return withActionText(`Filled ${fieldCount} form fields`, snapshot);
    },
};
const PressKeySchema = z.object({
    key: z.string().describe("Name of the key to press or character to generate (e.g., 'Enter', 'ArrowLeft', 'a')"),
});
export const browserPressKey = {
    schema: {
        name: "browser_press_key",
        description: "Press a key on the keyboard",
        inputSchema: zodToJsonSchema(PressKeySchema),
    },
    handle: async (params) => {
        if (!hasExtensionConnection()) {
            await waitForBridgeConnection(4000);
        }
        await callExtension("press_key", params);
        const snapshot = await captureAriaSnapshot();
        return withActionText(`Pressed key ${params.key}`, snapshot);
    },
};
const DragSchema = z.object({
    startElement: z.string().describe("Human-readable source element description"),
    startRef: z.string().describe("Source element reference from browser_snapshot"),
    startSelector: z.string().optional().describe("Optional CSS selector fallback for the source element"),
    endElement: z.string().describe("Human-readable target element description"),
    endRef: z.string().describe("Target element reference from browser_snapshot"),
    endSelector: z.string().optional().describe("Optional CSS selector fallback for the target element"),
});
export const browserDrag = {
    schema: {
        name: "browser_drag",
        description: "Perform drag and drop between two elements",
        inputSchema: zodToJsonSchema(DragSchema),
    },
    handle: async (params) => {
        if (!hasExtensionConnection()) {
            await waitForBridgeConnection(4000);
        }
        await callExtension("drag_element", params);
        const snapshot = await captureAriaSnapshot();
        return withActionText(`Dragged "${params.startElement}" to "${params.endElement}"`, snapshot);
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
