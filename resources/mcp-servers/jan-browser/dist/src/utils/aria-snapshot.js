/**
 * Captures accessibility tree information for LLM understanding
 */
import { callExtension, setActiveTabId } from "./bridge.js";
export async function captureAriaSnapshot(url, status = "") {
    try {
        const data = await callExtension("snapshot", url ? { url } : {});
        // Validate that we have snapshot data
        if (!data || !data.data) {
            console.error("[aria-snapshot] No data returned from extension", { data });
            return {
                content: [
                    {
                        type: "text",
                        text: "Failed to capture snapshot: No data returned from extension",
                    },
                ],
                isError: true,
            };
        }
        // Validate minimum required fields
        if (!data.data.url && !data.data.title) {
            console.error("[aria-snapshot] Snapshot data missing required fields", { data: data.data });
            return {
                content: [
                    {
                        type: "text",
                        text: "Failed to capture snapshot: Snapshot data is incomplete (missing url and title)",
                    },
                ],
                isError: true,
            };
        }
        if (typeof data.data.tabId === "number") {
            setActiveTabId(data.data.tabId);
        }
        const snapshot = formatSnapshotAsYAML(data.data);
        // Ensure we have non-empty snapshot
        if (!snapshot || snapshot.trim().length === 0) {
            return {
                content: [
                    {
                        type: "text",
                        text: `${status ? `${status}\n` : ""}Snapshot captured but page appears empty or snapshot data is incomplete.`,
                    },
                ],
            };
        }
        const pageUrl = data.data.url || "unknown";
        const pageTitle = data.data.title || "Untitled";
        // Build the text content
        const statusLine = status ? `${status}\n` : "";
        const textContent = `${statusLine}- Page URL: ${pageUrl}
- Page Title: ${pageTitle}
- Page Snapshot (ARIA Tree + Metadata)
\`\`\`yaml
${snapshot}
\`\`\`
`;
        // Final safety check - ensure text is non-empty after trimming
        if (!textContent || textContent.trim().length === 0) {
            return {
                content: [
                    {
                        type: "text",
                        text: "Snapshot error: Generated empty content (this should not happen)",
                    },
                ],
                isError: true,
            };
        }
        return {
            content: [
                {
                    type: "text",
                    text: textContent,
                },
            ],
            _meta: { urls: [pageUrl] },
        };
    }
    catch (err) {
        return {
            content: [
                {
                    type: "text",
                    text: `Failed to capture snapshot: ${err.message || err}`,
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
    const lines = [];
    lines.push(`url: ${data.url || "unknown"}`);
    lines.push(`title: ${data.title || "Untitled"}`);
    if (data.description) {
        lines.push(`description: ${data.description}`);
    }
    lines.push(`viewport:`);
    lines.push(`  width: ${data.viewport?.width || 0}`);
    lines.push(`  height: ${data.viewport?.height || 0}`);
    // ARIA Landmarks
    if (data.aria?.landmarks?.length > 0) {
        lines.push(`landmarks:`);
        for (const landmark of data.aria.landmarks.slice(0, 10)) {
            lines.push(`  - role: ${landmark.role || "unknown"}`);
            if (landmark.ariaLabel)
                lines.push(`    label: "${landmark.ariaLabel}"`);
            if (landmark.id)
                lines.push(`    id: ${landmark.id}`);
        }
    }
    // Interactive Elements (most important for automation)
    if (data.aria?.interactive?.length > 0) {
        lines.push(`interactive:`);
        for (const el of data.aria.interactive.slice(0, 20)) {
            lines.push(`  - [${el.index}] ${el.role || "unknown"}`);
            if (el.label)
                lines.push(`    label: "${el.label.slice(0, 80)}"`);
            if (el.id)
                lines.push(`    id: ${el.id}`);
            if (el.href)
                lines.push(`    href: ${el.href}`);
            if (el.type)
                lines.push(`    type: ${el.type}`);
        }
    }
    // Headings structure
    if (data.headings?.length > 0) {
        lines.push(`headings:`);
        for (const h of data.headings.slice(0, 10)) {
            lines.push(`  - ${h.level}: "${(h.text || "").slice(0, 100)}"`);
        }
    }
    // Forms
    if (data.forms?.length > 0) {
        lines.push(`forms:`);
        for (const form of data.forms.slice(0, 3)) {
            lines.push(`  - action: ${form.action || "(none)"}`);
            lines.push(`    method: ${form.method || "get"}`);
            if (form.fields?.length > 0) {
                lines.push(`    fields:`);
                for (const field of form.fields.slice(0, 5)) {
                    lines.push(`      - ${field.type || "unknown"}: ${field.name || field.id || "(unnamed)"}`);
                }
            }
        }
    }
    // Ensure we always return at least basic info
    if (lines.length < 3) {
        lines.push("note: Page snapshot appears minimal or empty");
    }
    return lines.join("\n");
}
