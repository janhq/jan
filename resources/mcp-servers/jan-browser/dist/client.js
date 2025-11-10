/// <reference types="node" />
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
async function main() {
    // Spawn the local MCP server via stdio
    const transport = new StdioClientTransport({
        command: "node",
        args: ["dist/src/index.js"],
    });
    const client = new Client({
        name: "search-mcp-client",
        version: "0.1.0",
    });
    try {
        await client.connect(transport);
        console.log("[client] connected to server");
        // Verify server binary version
        try {
            const info = await client.callTool({ name: "server_info", arguments: {} });
            console.log("[client] server_info:\n" + JSON.stringify(info, null, 2));
        }
        catch { }
        // Wait for the browser extension to connect to the bridge
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        console.log("[client] polling bridge_status for up to 15s...");
        let connected = false;
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
            try {
                const status = await client.callTool({ name: "bridge_status", arguments: {} });
                const txt = status?.content?.[0]?.text ?? String(status ?? "");
                if (/connected:\s*true/i.test(txt)) {
                    connected = true;
                    break;
                }
            }
            catch { }
            await sleep(500);
        }
        console.log(`[client] bridge connected: ${connected}`);
        // Quick sanity: try to call the `search` tool
        const args = { query: "site:example.com example", numResults: 3 };
        try {
            const result = await client.callTool({ name: "search", arguments: args });
            console.log("[client] callTool result:\n" + JSON.stringify(result, null, 2));
            // If we have at least one URL, do a deep dive with visit_tool
            const firstUrl = result?._meta?.urls?.[0];
            if (typeof firstUrl === "string" && /^https?:\/\//i.test(firstUrl)) {
                console.log(`[client] visiting first URL with visit_tool: ${firstUrl}`);
                const visitRes = await client.callTool({ name: "visit_tool", arguments: { url: firstUrl, mode: "text" } });
                console.log("[client] visit_tool result:\n" + JSON.stringify(visitRes, null, 2));
            }
            else {
                console.log("[client] no URL to visit from search result");
            }
        }
        catch (err) {
            console.error("[client] callTool error:", err?.message || err);
            if (err && typeof err === "object") {
                const extra = {};
                for (const k of ["code", "data", "stack"]) {
                    if (k in err)
                        extra[k] = err[k];
                }
                if (Object.keys(extra).length) {
                    console.error("[client] error details:\n" + JSON.stringify(extra, null, 2));
                }
            }
        }
    }
    catch (e) {
        console.error("[client] failed to connect:", e);
    }
    finally {
        try {
            await client.close?.();
        }
        catch { }
        try {
            await transport.close?.();
        }
        catch { }
    }
    // Show last few lines of server log.txt if present (written on startup)
    try {
        const { readFileSync } = await import("fs");
        const txt = readFileSync("log.txt", "utf8");
        const tail = txt.trim().split(/\r?\n/).slice(-10).join("\n");
        console.log("[client] log.txt tail:\n" + tail);
    }
    catch { }
}
main().catch((e) => {
    console.error("[client] unexpected error:", e);
    process.exit(1);
});
