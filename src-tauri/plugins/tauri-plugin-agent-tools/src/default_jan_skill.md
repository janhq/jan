---
name: jan
description: Use when onboarding users to Jan Agent or explaining project and global configuration, skills, memory, providers, and MCP servers.
---
# Jan Agent
When enabled, Jan lists this skill's name and purpose. The model loads its body with `skill_read`
only when the task needs it.


Run `jan` in a folder. That CWD is the project root; `--project DIR` selects another root.

## Project files

Jan reads non-empty `JAN.md` files from the project root and its ancestors. The nearest file wins.
Jan creates this separate state tree on first use:

```text
<project>/
|-- JAN.md                 # always-loaded project instructions
`-- .jan/
    `-- agent/
        |-- agent.toml       # model, provider, budget, tools, skills
        |-- skills/
        |   `-- <name>/
        |       `-- SKILL.md # procedure, plus optional scripts/templates
        |-- memory/          # durable project facts
        |-- threads/         # saved conversations
        `-- subagents/       # reusable agent definitions
```

`agent.toml` has `[agent]`, `[provider]`, `[budget]`, `[tools]`, and `[skills]` sections.
A simple skill can be `skills/<name>.md`. Commit `JAN.md`, `agent.toml`, `skills/`, and
`subagents/`; gitignore `threads/`. Run `jan cli agent status --project .` to scaffold the tree.

## User-global files

`~/.jan/` is separate from a project's `.jan/`:

```text
~/.jan/
`-- config.toml              # CLI provider configuration and credentials
```

Jan Desktop stores its settings and shared MCP configuration under the platform support folder:

```text
<support-folder>/Jan/
|-- settings.json             # Desktop settings, including an optional data_folder
`-- data/                     # default JAN_DATA_FOLDER
    |-- mcp_config.json       # shared MCP server definitions
    `-- agent-workspace/      # Desktop-global agent store
        |-- skills/
        |-- memory/
        `-- threads/
```

Default `<support-folder>`:

```text
macOS:   ~/Library/Application Support
Linux:   $XDG_DATA_HOME, or ~/.local/share
Windows: %APPDATA%
```

`JAN_DATA_FOLDER` overrides the `data/` location. Otherwise Jan uses
`settings.json`'s `data_folder`, then `<support-folder>/Jan/data`.
Add MCP servers in Desktop at `Settings > MCP Servers`; Jan writes
`<JAN_DATA_FOLDER>/mcp_config.json`.
