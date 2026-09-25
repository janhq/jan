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
`JAN.md` is the only file Jan keeps in the project; commit it to share instructions.
Everything else is per-user state under `~/.jan/`, created on first use.

## User files

```text
~/.jan/
|-- config.toml              # CLI provider configuration and credentials
|-- MEMORY.md                # generated index: user notes + projects with memory
|-- memory/                  # user-wide notes (`user:<name>`), every project
`-- projects/
    `-- <name>-<hash>/       # one per project directory (git worktrees share it)
        |-- project.json     # which directory this store belongs to
        |-- agent.toml       # model, provider, budget, tools, skills
        |-- MEMORY.md        # generated index of this project's notes
        |-- memory/          # durable project facts
        |-- skills/
        |   `-- <name>/
        |       `-- SKILL.md # procedure, plus optional scripts/templates
        |-- plugins/
        |-- threads/         # saved conversations
        `-- subagents/       # reusable agent definitions
```

`agent.toml` has `[agent]`, `[provider]`, `[budget]`, `[tools]`, and `[skills]` sections.
A simple skill can be `skills/<name>.md`. Run `jan cli agent status --project .` to scaffold
the store. A project that still has a `.jan/` folder from an older Jan is moved into
`~/.jan/projects/` automatically the next time Jan starts in it.
`memory_cross_project = false` in `config.toml` hides other projects' memory from the agent.

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
