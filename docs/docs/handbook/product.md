---
title: Product
---

We use Github for 100% of our product / project management.

As much as possible, everyone owns their respective `epics` and `tasks`.

> We aim for a `loosely coupled, but tightly aligned` autonomous culture.

## Organization

[`Projects`](https://github.com/janhq/jan/projects?query=is%3Aopen)

- `Projects` track large, long-term, & strategic initiatives that can span multiple teams and multiple sprints
- `Projects` contain `epics`

[`Epics`](https://github.com/janhq/jan/issues?q=is%3Aissue+is%3Aopen+label%3A%22type%3A+epic%22)

- `Epics` track large stories that span 1-2 weeks, and it outlines specs, architecture decisions, designs
- Each `epic` corresponds with a Github `milestone`
- `Epics` contain `tasks`
- `Epics` should only have 1 owner

[`Milestones`](https://github.com/janhq/jan/milestones)

- `Milestones` correspond 1:1 to `epics` and are used to filter [Project Views](https://github.com/orgs/janhq/projects/5/views/1)
- `Milestones` span 1-2 weeks and have deadlines

[`Tasks`](https://github.com/janhq/jan/issues)

- Tasks are individual issues (feats, bugs, chores) that can be completed within a few days
- Tasks under `In-progress` and `Todo` should always belong to a `milestone`
- Tasks are usually named per [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/#summary)
- Tasks should only have 1 owner

We aim to always work on `tasks` that belong to a `milestones`.

## Task Status

- `triaged`: issues that have been assigned
- `todo`: issues you plan to tackle within this week
- `in-progress`: in progress
- `in-review`: pending PR or blocked by something
- `done`: done
