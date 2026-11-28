---
name: jan-local-api-server
description: >-
  Configure and call the Jan desktop app's OpenAI-compatible Local API
  Server (default http://127.0.0.1:1337/v1): host, port, prefix, API key,
  trusted hosts, CORS, server-side MCP tool execution, and troubleshooting
  401/404/CORS errors. Use when building an app against Jan or exposing it
  on a network.
---

# Jan Local API Server

Reference: `docs/src/pages/docs/desktop/api-server.mdx`.

## Start and test

In Jan: **Settings > Local API Server > Start Server**. Ready when the log
shows `JAN API listening at http://127.0.0.1:1337`.

```bash
curl http://127.0.0.1:1337/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JAN_API_KEY" \
  -d '{"model":"<model id from Jan>","messages":[{"role":"user","content":"Hello"}]}'
```

```python
import os
from openai import OpenAI
client = OpenAI(base_url="http://127.0.0.1:1337/v1", api_key=os.environ["JAN_API_KEY"])
```

## Settings

| Setting | Default | Notes |
|---------|---------|-------|
| Host | `127.0.0.1` | `0.0.0.0` exposes it to the LAN; Jan refuses to start there without an API key |
| Port | `1337` | |
| API prefix | `/v1` | Changes every path |
| API key | empty | When set, clients send `Authorization: Bearer <key>` |
| Trusted hosts | localhost, private IPv4, link-local | List Tailscale `100.64.x.x`, IPv6 private (`[fd00::5]`) and hostnames such as `my-mac.local` explicitly; `*` only allows any web origin |
| Request timeout | | Raise for big models on slow hardware |
| Execute tools on server | off | MCP tool calls from `/v1/chat/completions` run inside Jan instead of returning to the client |
| CORS | on | Turn off if only non-browser clients connect |
| Verbose logs | on | Use them when debugging |

## Troubleshooting

- Connection refused: server not started, or wrong host/port.
- 401: missing or wrong `Authorization` bearer key.
- 404: model ID doesn't match a model in Jan, or the URL ignores the
  configured prefix.
- CORS error in the browser: enable CORS.

For a headless endpoint without the desktop UI, use `jan serve`
(port 6767) from the `jan-serve-models` skill.
