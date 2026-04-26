# OpenClaw Runtime Center Design

**Date:** 2026-04-26  
**Scope:** `web-app/src/routes/openclaw/index.tsx` and related OpenClaw management UI  
**Status:** Approved for implementation planning

## Goal

Redesign the current `OpenClaw 实例管理` page from a single launch card into a proper single-runtime lifecycle and configuration center.

This iteration manages exactly one local OpenClaw runtime. It is not a multi-instance control plane.

## Product Decision

The page is responsible for:

- install / detect OpenClaw
- show current runtime state
- start / stop / restart the runtime
- expose a small set of high-frequency configuration options in a dedicated dialog
- provide a direct entry to OpenClaw's built-in web control UI for advanced management

The page is not responsible for:

- multi-instance creation or switching
- full logs and diagnostics workflows
- deep expert configuration
- replacing OpenClaw's own complete management console

## External Constraint

OpenClaw already provides its own browser-based dashboard / control UI. According to the official docs:

- install and prerequisite guidance live at `https://docs.openclaw.ai/install`
- the local dashboard is served by the gateway and is intended as the full control UI

RongxinAI should not duplicate that advanced management surface in this iteration. It should provide a clear handoff to it.

## Page Positioning

The page should feel like a runtime operations center, not a shortcut card and not a generic form page.

Primary user questions on entry:

1. Is OpenClaw installed?
2. Is it running right now?
3. What address is it serving on?
4. Can I start, stop, or restart it safely?
5. Where do I change the common settings?
6. If I need advanced control, where do I go?

## Recommended Information Architecture

Use a three-layer structure.

### 1. Top Status Bar

Purpose: immediate runtime awareness and primary actions.

Must include:

- page title: `OpenClaw 实例管理`
- runtime status badge
- version if known
- gateway address / port if known
- primary actions:
  - `安装`
  - `启动`
  - `停止`
  - `重启`
- secondary actions:
  - `编辑配置`
  - `打开 OpenClaw 控制台`

Behavior:

- actions shown are state-dependent
- only one primary action is visually dominant
- `打开 OpenClaw 控制台` remains visible once a usable gateway URL exists

### 2. Lifecycle Main Panel

Purpose: explain current state and next best action.

This replaces the current all-in-one card with a more management-oriented summary panel.

Panel content changes by state:

- `未安装`
  - short explanation
  - install CTA
  - prerequisite note that OpenClaw needs supported Node.js
- `已安装，未运行`
  - ready state summary
  - last known config summary
  - start CTA
- `启动中`
  - progress / current phase text
  - disable conflicting actions
- `运行中`
  - running confirmation
  - gateway URL
  - summary of current launch mode
- `停止中`
  - pending state copy
  - disable start / restart until settled
- `异常`
  - concise failure summary
  - retry CTA
  - path to advanced management page if relevant

### 3. Configuration Summary Area

Purpose: show a compact snapshot of the current common settings without turning the page into a giant form.

This should be read-only on the page itself.

Suggested fields:

- launch mode
  - `按 OpenClaw 当前配置启动`
  - `注入本地 Ollama 模型`
- selected local Ollama model if injection is enabled
- gateway port
- auto-start / startup preference if supported
- working directory or config source summary if available

This area also includes the `编辑配置` entry.

## Configuration Editing Model

### Core Decision

Common settings are edited in a dedicated dialog, not inline on the page.

Reason:

- OpenClaw configuration surface is already relatively large
- inline editing would quickly bloat the page
- the main page should stay focused on lifecycle control
- advanced configuration already has a better home in OpenClaw's own dashboard

### Configuration Dialog Structure

The dialog should expose only frequent, high-value settings.

Use three groups.

#### Group A: Basic Runtime

- gateway port
- auto-start preference if supported
- selected runtime mode summary

#### Group B: Model Access

- default mode: use existing OpenClaw configuration
- optional switch: inject local Ollama model
- if enabled:
  - model selector
  - short note explaining this is a convenience override, not the only supported model path

#### Group C: Network / Safety

- local-only / bind behavior if currently supported by backend
- any high-frequency safety switch already available in current product scope

Dialog footer:

- `取消`
- `保存`
- `保存并重启`

Rules:

- if a changed field requires restart, show that clearly
- do not expose long-tail expert settings in this dialog
- advanced settings should route to OpenClaw's own web control UI

## Advanced Management Handoff

### Entry

Provide a clear secondary action:

- `打开 OpenClaw 控制台`

### Recommended First Iteration

Open the built-in OpenClaw dashboard in the user's browser.

Do not embed it inside RongxinAI in this iteration.

Reason:

- embedded admin surfaces create sizing, auth, security, and navigation complexity
- the browser handoff is simpler and less brittle
- this page should remain a lifecycle center, not a full dashboard container

### Future-Compatible Extension

If later needed, RongxinAI can evaluate an embedded preview or embedded console mode. That should be a separate iteration, not part of this one.

## State Model

The page should express these runtime states consistently:

- `not-installed`
- `installing`
- `installed`
- `starting`
- `running`
- `stopping`
- `error`

Notes:

- today the hook API is simpler; implementation may need to extend it to represent `starting`, `stopping`, and `error` more explicitly
- UI copy and available actions must be driven by this state model

## Interaction Rules

### Start

- if OpenClaw is installed and idle, `启动` is the primary CTA
- if common config is invalid, prevent launch and route user to `编辑配置`

### Stop

- `停止` must be available only in running or starting-related states where backend can reconcile toward stopped
- if stop is asynchronous, show pending state rather than leaving the user guessing

### Restart

- `重启` is available only when the runtime is healthy enough to restart
- after saving restart-required config, surface `保存并重启` directly in the dialog

### Install

- install path remains the primary CTA when OpenClaw is absent
- after install success, return user to the same page state with `启动` now emphasized

## UI Direction

Use a control-console layout, not a marketplace card layout.

### Layout

- top status strip across the page
- below it, separate panels rather than one oversized card
- desktop-first, but collapse to single column on narrow widths

### Visual Hierarchy

- P0: state + main actions
- P1: gateway address + config summary
- P2: advanced handoff and secondary utilities

### Component Style

- keep current Jan / shadcn visual language
- compact badges for status
- explicit button grouping for lifecycle actions
- restrained use of warning / danger colors only when action risk is real

## Copy Guidelines

The page should speak in operational language:

- state first
- next action second
- explanation third

Examples:

- `OpenClaw 未安装`
- `OpenClaw 已安装，当前未运行`
- `OpenClaw 正在启动`
- `OpenClaw 运行中`
- `OpenClaw 启动失败`

Avoid vague labels like `管理` as the only action label. Actions should be explicit.

## Migration From Current Page

Current page:

- one `OpenClawCard`
- one launch dialog

Target page:

- keep the existing install / launch / stop capabilities
- promote runtime state and main controls to the page shell
- convert the launch dialog into a broader configuration dialog
- preserve the existing optional local Ollama injection flow, but reposition it under common configuration
- remove the impression that OpenClaw must use a local model

## Explicit Non-Goals

This iteration does not include:

- multiple OpenClaw runtimes
- a runtime list page
- full logs viewer
- deep diagnostics center
- embedded OpenClaw dashboard
- replacing OpenClaw's entire native control surface

## Implementation Impact

Likely affected areas:

- `web-app/src/routes/openclaw/index.tsx`
- `web-app/src/components/hub/OpenClawCard.tsx`
- `web-app/src/components/hub/OpenClawConfigDialog.tsx`
- `web-app/src/hooks/useOpenClaw.ts`

Possible new components:

- top status / action strip for OpenClaw
- compact configuration summary panel

## Acceptance Criteria

The design is successful when:

1. The page immediately tells the user whether OpenClaw is installed and running.
2. Users can install, start, stop, and restart without opening a secondary page.
3. Common settings are editable in one focused dialog.
4. Advanced management has a clear handoff to OpenClaw's own dashboard.
5. The page no longer reads like a single launch card pretending to be an instance manager.
