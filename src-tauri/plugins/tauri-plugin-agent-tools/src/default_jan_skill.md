---
name: jan
description: Use when onboarding users to Jan Agent or explaining project and global configuration, skills, memory, providers, and MCP servers.
---
# Jan Agent

Run `jan` in a folder. That CWD is the project root; `--project DIR` selects another root.

## Project state

`<project>/.jan/agent/` is created on first use:

- `agent.toml`: model, provider override, budget, tools, and skills.
- `AGENT.md`: always-on project instructions.
- `skills/<name>/SKILL.md` or `skills/<name>.md`: reusable procedures.
- `memory/`: durable project facts. `threads/`: saved sessions. `subagents/`: reusable agents.

Run `jan cli agent status --project .` to scaffold it. Commit `agent.toml`, `AGENT.md`, `skills/`, and `subagents/`; gitignore `threads/`.

## Global state

- `~/.jan/config.toml`: provider configuration and credentials.
- `<JAN_DATA_FOLDER>/mcp_config.json`: MCP servers. Desktop: **Settings > MCP Servers**.
- `<JAN_DATA_FOLDER>/agent-workspace/`: Desktop-global `skills/`, `memory/`, and `threads/`. `JAN_DATA_FOLDER` or the Desktop data-folder setting selects the root.

## References

[Project config](https://jan.ai/docs/agent/project-config) | [Skills](https://jan.ai/docs/agent/skills) | [MCP servers](https://jan.ai/docs/desktop/integrations/mcp-servers)
