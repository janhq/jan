# Commit Review Report

**Scope:** Commits 27a96bb..HEAD (recent 6 commits)
**Date:** 2026-04-07

## Fixes Applied

### 1. Hardcoded text file size constant (parser.rs)
- **Severity:** Low
- **Status:** Fixed — extracted `MAX_TEXT_FILE_SIZE` constant to align with existing pattern
- **Files:** `constants.rs`, `parser.rs`

### 2. Duplicate state reset in useBackendUpdater
- **Severity:** Low
- **Status:** Fixed — extracted `resetUpdateState()` helper
- **Files:** `useBackendUpdater.ts`

## Open Concerns

### 3. Triple source of truth for supported file extensions
- **Severity:** Medium
- **Impact:** File extension lists are independently maintained in `parser.rs` (Rust backend), `ChatInput.tsx` (upload UI), and `ProjectFiles.tsx` (project browser). Divergence risks users seeing different supported types in different UI surfaces or backend rejecting files the UI accepts.
- **Recommendation:** Consolidate into a single source — either expose supported extensions via a Tauri command that the frontend queries, or define them in a shared JSON/config file consumed by both Rust and TypeScript at build time.
- **Next steps:** Create a tracking issue; requires cross-team alignment on approach.

### 4. Silent MCP tools/list verification fallback
- **Severity:** Low
- **Impact:** When `tools/list` verification fails after MCP server ready event, the code falls back silently. The health monitor will eventually recover, but users see no immediate feedback if MCP tools fail to load.
- **Recommendation:** Consider emitting a transient warning notification when verification fails, so users know tools may be temporarily unavailable.
- **Next steps:** Low priority; monitor for user-reported confusion.

### 5. CSS magic numbers in responsive settings fix
- **Severity:** Low (cosmetic)
- **Impact:** Hardcoded pixel breakpoints and widths in the responsive CSS fix. Functional but could drift from design tokens.
- **Recommendation:** Extract breakpoints into CSS variables or Tailwind config if the project adopts a design token system.
- **Next steps:** No action needed unless design system is formalized.

### 6. Potential race condition in useBackendUpdater
- **Severity:** Low
- **Impact:** If the llamacpp provider is toggled while `checkForUpdate` or `updateBackend` is in-flight, the async operation may complete and set state for a now-disabled provider. The existing `isUpdating` guard partially mitigates this.
- **Recommendation:** Add an early-exit check after each `await` point, or use an AbortController pattern.
- **Next steps:** Monitor; only fix if users report stale update prompts after disabling provider.
