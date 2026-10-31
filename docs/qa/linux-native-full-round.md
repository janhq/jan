# Linux native full UI round — 2026-10-31

## Current disposition
**Native execution BLOCKED by explicit desktop permission denial.** No fresh native PASS claims. Linux ownership only; Windows untouched.

- SSH alias `vm` is accessible using existing credentials (no credentials read/exported).
- Saved Orca environment `VM`, runtime `6159b984-5016-4172-b2ae-8fcbb46122db`, is reachable.
- `orca computer permissions --environment VM --json` returns `forbidden`: “Method 'computer.permissions' needs the 'desktop-control' permission, which this paired client was not granted when it paired.”
- This is an authorization block, not missing Linux support. Prior capability JSON advertises native screenshots/input, but does not grant permission. No SSH/xdotool, WebDriver UI interaction, X11 screenshot or alternate runtime used to bypass it.
- Existing prior-QA Xvfb `:78` PID **582334** (`-screen 0 1600x1000x24 -nolisten tcp`) and Openbox PID **582419** are alive. Neither started, controlled nor signalled this round. No owned GUI PIDs yet.

## Readiness / source preparation (incremental)
- Read `qa-process-safety` and isolation portions of `launch-qa`.
- Existing `/tmp/jan-launch-audit/linux/{build.sh,launch.sh,source-manifest.json}` inspected. Old source/screenshots are explicitly not fresh evidence.
- Remote Ubuntu x86_64; Node 22.23.2; system Yarn 1.22.22; Cargo/Rust installed under existing user toolchain; WebKitGTK 4.1 **2.52.6**, GTK3 **3.24.41**; 232 GiB disk free.
- Existing isolated QA source has dependency/build caches. No global installation or user data reuse planned.
- Current source inspection confirms `HomeWorkspacePicker` now follows `ChatInput` in `web-app/src/routes/index.tsx` (below composer), async project save awaits `addFolder`, and current project/skills fixes will be included by byte-exact snapshot rather than HEAD-only checkout.
- Fresh dirty-source archive transferred to VM. Local evidence `/tmp/jan-launch-audit/linux-current/`: `source.tar.gz`, `source-manifest.json`, `source-manifest-final.json`, `source-status.txt`, `source.patch`. Base HEAD `9733e9416f939f65cfea4d0fc5f9d64724c3c3bc`. Snapshot includes untracked production files and latest folder-below/project/skills fixes, excludes node_modules, targets, dist/build, `.git`, `.yarn` and caches. Byte hashes checked against current source; concurrent parent updates to `CoworkWorkspacePill.tsx` and `__tests__/CoworkWorkspacePill.test.tsx` were detected by SHA256 (not silently ignored); exact current bytes transferred as `source-delta.tar.gz` and recorded in the final manifest.
- Destination: `/home/james/jan-ui-full-20261031-current/source`; **Remote SHA256 verification PASSED: 2,857 files, zero mismatches**, recorded in `/home/james/jan-ui-full-20261031-current/transfer-verified.txt`; local command output `/var/folders/20/b66rbv857vd5lj4w7sf301480000gn/T/jan-bash/jan-bash-40663-9.txt`. No old build used as fresh evidence.
- **Build deliberately not started:** user requested avoiding a huge build when native permission blocks the matrix. Existing Jan-Desktop executable is old (2026-10-31 00:24 UTC); cannot validate latest source. Existing isolated `build.sh` is reusable, with project Yarn via `corepack yarn` rather than system Yarn1. No dependency/global installation performed.
- Parent reports folder-below focused tests **23/23 PASS** at source freeze; not represented as Linux native passes.

## Bounded matrix
Reference: `docs/qa/ui-matrix-full-round.md`; fresh Linux representative pairwise round at 1600/1280/1024, light/dark. All rows currently blocked by the explicit permission denial above, not inferred app failures.

|ID|Native case|Status|Evidence / limit|
|---|---|---|---|
|01|Dark Chat home 1600|BLOCKED|Desktop permission|
|02|Dark Cowork home; folder picker below composer 1600|BLOCKED|Desktop permission; source placement inspected only|
|03|Light Chat home 1280|BLOCKED|Desktop permission|
|04|Light Cowork home; folder picker below composer 1024|BLOCKED|Desktop permission|
|05|Composer plus: upload/folder/project/assistant/tools|BLOCKED|Desktop permission|
|06|Plan toggle and reopen retained state|BLOCKED|Desktop permission|
|07|1024 composer overflow/hidden controls|BLOCKED|Desktop permission|
|08|Light reasoning selection and reopen|BLOCKED|Desktop permission|
|09|Dark reasoning submenu over HTML preview|BLOCKED|Desktop permission|
|10|Model settings open/edit/dismiss|BLOCKED|Desktop permission|
|11|Project create with assistant, actual save|BLOCKED|Desktop permission|
|12|Project edit/save/reopen persistence|BLOCKED|Desktop permission|
|13|Assistant light edit/save/reopen|BLOCKED|Desktop permission|
|14|Assistant dark parameter menu/layering|BLOCKED|Desktop permission|
|15|Global skill create/save/read|BLOCKED|Desktop permission|
|16|Folder skill edit/save/reopen|BLOCKED|Desktop permission|
|17|Project skill scope and drafts|BLOCKED|Desktop permission|
|18|Synthetic inactive MCP ON|BLOCKED|Desktop permission; external MCP forbidden|
|19|Synthetic MCP OFF and dark rows|BLOCKED|Desktop permission|
|20|Offline HTML preview light|BLOCKED|Desktop permission|
|21|Markdown preview|BLOCKED|Desktop permission|
|22|CSV preview|BLOCKED|Desktop permission|
|23|SVG preview|BLOCKED|Desktop permission|
|24|Preview toolbar overflow/popup|BLOCKED|Desktop permission|
|25|Preview expand/restore|BLOCKED|Desktop permission|
|26|Preview close/reopen/Escape|BLOCKED|Desktop permission|
|27|Preview keyboard splitter resize|BLOCKED|Desktop permission|
|28|1024 actual native compact preview light/dark|BLOCKED|Desktop permission|
|29|1280/1600 restore, native Linux titlebar controls|BLOCKED|Desktop permission|
|30|Settings screens/general/interface/providers/MCP/tools and saved toggles|BLOCKED|Desktop permission|

## Host-local terminal investigation
Read-only discovery found `/home/james/.local/bin/orca` (absent from noninteractive SSH PATH), existing VM runtime ready and two terminals including `Jan ready` at `/home/james/work/jan`. No commands injected into these terminals. Host-local `/home/james/.local/bin/orca status --json` reports `desktopWindowStatus: blocked`; local `computer permissions --json` returns Linux accessibility and screenshots **unsupported**, `nextStep: null`, not an independent desktop grant. No worker/terminal/runtime launched to route around the paired-client denial.

## Safety / unblock
No inference, external provider validation, real user state, global installs, process signals or production source edits. **User action required:** on the VM's Orca owner UI, grant the current Mac paired client **desktop-control** in its device/pairing permissions, or re-pair this Mac with desktop control enabled. Then rerun `orca computer permissions --environment VM --json` from this Mac and confirm the `forbidden` error is gone. The current local CLI reports unsupported OS permission helpers, so it cannot open a Linux grant dialog. If this headless runtime cannot expose owner settings, an owner must start/configure an authorized desktop-control runtime; this tester must not self-grant or route around denial. Screenshots from the previous round cannot disposition current-source rows.
