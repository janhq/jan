/**
 * Captures accessibility tree information for LLM understanding
 */
import { callExtension, setActiveTabId } from "./bridge.js";
function extractText(response, fallback = "") {
    if (!response)
        return fallback;
    const direct = response?.data?.text || response?.data?.title || response?.data?.url;
    if (typeof direct === "string" && direct.trim())
        return direct.trim();
    const contentEntry = Array.isArray(response?.content) ? response.content.find((item) => item?.type === "text") : null;
    if (contentEntry?.text)
        return String(contentEntry.text);
    return fallback;
}
export async function captureAriaSnapshot(targetUrl, status = "", fullPage = true) {
    try {
        const params = targetUrl ? { url: targetUrl, fullPage } : { fullPage };
        const urlResponse = await callExtension("getUrl", params);
        const titleResponse = await callExtension("getTitle", params);
        const snapshotResponse = await callExtension("browser_snapshot", params);
        const pageUrl = urlResponse?.data?.url ||
            extractText(urlResponse) ||
            snapshotResponse?.data?.url ||
            targetUrl ||
            "unknown";
        const pageTitle = titleResponse?.data?.title ||
            extractText(titleResponse) ||
            snapshotResponse?.data?.title ||
            "Untitled";
        const yamlEntry = Array.isArray(snapshotResponse?.content)
            ? snapshotResponse.content.find((item) => item?.type === "text")
            : null;
        const yaml = (yamlEntry?.text && String(yamlEntry.text)) ||
            (snapshotResponse?.data ? formatSnapshotAsYAML(snapshotResponse.data) : 'error: No snapshot data available');
        const tabId = (snapshotResponse?._meta?.tabId ??
            snapshotResponse?.data?.tabId ??
            urlResponse?._meta?.tabId ??
            titleResponse?._meta?.tabId);
        if (typeof tabId === "number") {
            setActiveTabId(tabId);
        }
        const statusLine = status ? `${status}\n` : "";
        const text = `${statusLine}- Page URL: ${pageUrl}
- Page Title: ${pageTitle}
- Page Snapshot
\`\`\`yaml
${yaml}
\`\`\`
`;
        const meta = {};
        if (pageUrl && pageUrl !== "unknown") {
            meta.urls = [pageUrl];
        }
        if (typeof tabId === "number") {
            meta.tabId = tabId;
        }
        return {
            content: [
                {
                    type: "text",
                    text,
                },
            ],
            _meta: Object.keys(meta).length ? meta : undefined,
        };
    }
    catch (err) {
        return {
            content: [
                {
                    type: "text",
                    text: `Failed to capture snapshot: ${err?.message || err}`,
                },
            ],
            isError: true,
        };
    }
}
/**
 * Format snapshot data as YAML-like structure for better LLM readability
 */
function formatSnapshotAsYAML(data) {
    if (!data) {
        return "error: No snapshot data available";
    }
    const tree = data.aria?.tree;
    if (tree) {
        return renderTree(tree).join("\n");
    }
    // Fallback to minimal metadata when tree is unavailable
    const fallback = [];
    fallback.push(`url: ${data.url || "unknown"}`);
    fallback.push(`title: ${data.title || "Untitled"}`);
    if (data.description)
        fallback.push(`description: ${data.description}`);
    return fallback.join("\n");
}
function renderTree(node, depth = 0) {
    const lines = [];
    const indent = "  ".repeat(depth);
    const parts = [];
    const role = (node?.role || node?.tag || "node").toString();
    parts.push(role);
    if (node?.name) {
        parts.push(`"${String(node.name)}"`);
    }
    const stateFlags = [];
    const state = node?.state || {};
    if (state.expanded)
        stateFlags.push("[expanded]");
    if (state.selected)
        stateFlags.push("[selected]");
    if (state.checked)
        stateFlags.push("[checked]");
    if (state.focused)
        stateFlags.push("[focused]");
    if (state.disabled)
        stateFlags.push("[disabled]");
    const ref = node?.ref || node?.id || node?.backendNodeId || node?.domNodeId;
    const headerParts = [...parts, ...stateFlags];
    if (ref) {
        headerParts.push(`[ref=${ref}]`);
    }
    const children = Array.isArray(node?.children) ? node.children : [];
    const detailLines = buildDetailLines(node, depth + 1);
    const needsColon = children.length > 0 || detailLines.length > 0;
    const header = `${indent}- ${headerParts.join(" ")}`.replace(/\s+/g, " ").trim() + (needsColon ? ":" : "");
    lines.push(header);
    lines.push(...detailLines);
    for (const child of children) {
        lines.push(...renderTree(child, depth + 1));
    }
    return lines;
}
function buildDetailLines(node, depth) {
    const lines = [];
    const indent = "  ".repeat(depth);
    const url = node?.properties?.url || node?.href;
    if (url) {
        lines.push(`${indent}- /url: ${url}`);
    }
    const textValue = node?.value || node?.text || node?.description;
    if (textValue) {
        lines.push(`${indent}- text: ${String(textValue).slice(0, 400)}`);
    }
    return lines;
}
