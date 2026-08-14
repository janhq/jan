---
name: jan
description: Use when onboarding users to Jan or explaining where to customize Jan Agent, CLI, desktop, project settings, and skills.
---
# Jan

Use this for Jan onboarding and customization, not user projects or Jan development.

## Start

- Run `jan --version`, `jan --help`, then relevant subcommand help.
- Treat UI and command details as version-specific: inspect the current app or official Jan docs.
- Do not infer update behavior for source builds; inspect installed help or official docs.

## Customize

- Desktop: use Settings. Project Agent: inspect `.jan/agent/agent.toml` before changing models, providers, permissions, or budgets.
- Manage project skills with `skill_list`, `skill_read`, and `skill_write`, not undocumented paths.
