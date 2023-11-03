# ADR 004: UI Service

## Changelog

- 10 Oct 2023: initial vision @dan-jan @0xSage

## Status

Proposed

## Context

Plugin devs need an API to change the Jan UI. Before we layer on more features, let's ensure good devex for feature building.

## Decision

![Jan UI Framework](./images/jan-ui-framework.png)

- Side-Ribbon: Jan Apps

  - This is a protected area, for Apps
  - Apps can define Left Panel, Center, and Right Panel
  - We will only have 1 App for now (no need to build this abstraction yet)
  - Future: Server mode (see LMStudio), Art Studio (Stable Diffusion)

- Side-Ribbon: Global Settings

  - These will all open in a modal
  - Currently: Model Store, Running Models
  - Currently: User Login, Settings

- Main Window and Right Panel

  - These will mainly be session-based

- Console: production logs

## UiService API

We need a UI API for Plugins

- e.g. Model Store plugin -> Registers "Global Settings" Icon, defines what will show up in the Modal
- e.g. Model Runner plugin -> Inference Parameters

## Consequences

- Increased code complexity

## Reference

- VSCode
- Obsidian
