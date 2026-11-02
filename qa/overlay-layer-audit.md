# Shared overlay layer audit

## Contract and changes

Global tokens in `web-app/src/index.css`:

| Tier | Token | Owners |
| --- | --- | --- |
| 40 | `--layer-panel` | Feature side panels (separate feature audit) |
| 60 | `--layer-floating` | Ordinary dropdowns/submenus, popovers, tooltips, hover cards |
| 80 | `--layer-modal` | Dialog, sheet, Vaul drawer overlay and content |
| 90 | `--layer-modal-floating` | Floating descendants of those modal surfaces |
| 100 | `--layer-toast` | Sonner toaster |

`components/ui/overlay-layer.ts` supplies `useFloatingLayer()` and `ModalLayerContext`. Modal content provides context around its children; React portals preserve it even when their DOM is mounted under `body`. Floating primitives choose a literal Tailwind class from that context. DropDrawer inherits the dropdown/drawer policy; removed its submenu's overriding `z-50`. Tooltip arrows stay inside their content's stacking context and do not need a separate tier.

Modal overlay and content deliberately share 80: the overlay precedes content within each portal. Giving *all* modal contents a higher tier than *all* modal overlays would let a parent modal appear over a nested modal's backdrop. Nested modal portals retain DOM ordering at 80; dismissal/focus behavior remains Radix/Vaul's responsibility. Public classes, styles, refs and other props retain their existing pass-through behavior; explicit caller z-index overrides still override these defaults and require caller audit.

Sonner's imported CSS defaults to `z-index:999999999`. A more-specific `.toaster[data-sonner-toaster]` rule now sets 100 without inline style/CSP changes.

## Source findings / root causes

- All shared floating and modal primitives previously used the same `z-50`. Equal body-level layers depend on mounting/DOM order, not semantic importance; a later sheet could cover an earlier model popup.
- A portal escapes its original panel's stacking context but does not automatically outrank other body-level overlays. Raising a trigger's local z-index cannot repair this.
- Installed Radix Popper reads the content's computed z-index and applies it to its positioned wrapper (`@radix-ui/react-popper/dist/index.js`). Therefore the layer belongs on the actual primitive Content, not only a nested menu row or trigger.
- CSS variables scoped to modal DOM cannot promote a body-portaled child. React ownership context is used instead, including tooltip/hover-card portals and dropdown subcontent.
- No shared `select.tsx`, `alert-dialog.tsx`, or `context-menu.tsx` exists in this checkout. No replacement primitives were invented.

## Gaps / boundaries

- This is a tier policy, **not a global modal-stack manager**. A deliberately kept-open or controlled parent menu at 90 can remain visually above a later unrelated/nested modal at 80. Normal Radix dismissal flows are covered, but applications that keep multiple modal/popover roots open must close stale popups or adopt stack-aware ownership. Portals mounted into custom containers also remain constrained by that container's stacking context.
- Custom `ModelCombobox` and `FilePickerPopover` now use body portals and `useFloatingLayer()`; see the feature audit below.
- Raw/custom popup callers and explicit caller `className`/`style.zIndex` overrides bypass shared defaults. AppUpdater and PromptAnalytic now use body portals at floating60; source inventory also found sidebar/header local `z-50` and native window controls/resize grips at 60. Feature/titlebar ownership is outside this primitive change; those need separate semantic/layout review rather than blindly increasing numbers.
- No visual/native validation was performed by this audit. jsdom does not paint stacking contexts, test pointer hit order, collision positioning, desktop titlebar interaction, or platform CSP behavior.

## Validation

- Real-primitive jsdom tests in `components/ui/__tests__/overlay-layer.test.tsx`: body portal escape, ordinary vs modal tiers, dialog/sheet/drawer promotion, tooltip/hover-card ownership, Escape menu-before-dialog dismissal, nested dialog/popover dismissal and modal DOM order.
- Nine targeted primitive test files: **144 tests passed**. Existing Dialog/Sheet class assertions updated to token classes. Existing Radix description warnings remain.
- `node node_modules/eslint/bin/eslint.js .` from `web-app`: passed (full app).
- `node node_modules/typescript/bin/tsc -b` from `web-app`: passed.
- Yarn workspace test script could not find `cross-env` in this environment; tests were run successfully via `node node_modules/vitest/vitest.mjs run ...` from `web-app` instead.


## Feature-panel audit

### Trace and fixes

- `ComposerModelPicker`: main content uses the shared Popover dialog portal, with a dedicated inline footer menu; reasoning/effort submenus use the shared dropdown portals. No feature z-index override is used. Previously a phone preview at 50 tied dropdown50 and model-settings Sheet50; equal-layer DOM order could put the rail over the popup. Shared floating60/modal80 plus panel40 removes that tie. Docked rails also need an explicit panel tier because Motion opacity creates a stacking context during transitions.
- `CoworkSidePanel` (preview, diff, files, todo and task rails): all modes now use panel40. Desktop dock and tablet absolute overlay remain bounded below HeaderPage by their content parent. Phone fixed overlay now starts below the 60px titlebar, uses bottom0 rather than h-full, and retains full viewport width. Resize handle10 remains local. Existing inert/focus-trap and menu-first Escape behavior preserved and tested.
- `CoworkOverviewPanel`: desktop animated rail uses panel40; small-screen Sheet inherits modal80. Desktop top inset continues to avoid caption controls. Its intentional header-column extension is limited to the empty rail column; it does not cover caption controls.
- `ChatInput`: existing20 is a local composer context, with decorative30 inside it. Shared picker/sampling portals escape it. No ChatInput/HomeModeToggle edits by this audit.
- `ModelSetting` / `SamplerPopover`: controlled settings use shared Sheet and sampling uses Dialog (or legacy triggered Popover); no feature z overrides, so shared80/60 and modal-child90 apply.
- `ModelCombobox`: AddModel's custom body portal no longer uses9999; `useFloatingLayer()` supplies60 normally or90 under a modal owner.
- `FilePickerPopover`: previously inline absolute50 trapped below ChatInput20 and clipped by ancestors. Now body-portalled fixed at the inherited floating tier, converting textarea-bottom offsets into viewport coordinates, observing resize/scroll, clamping viewport bounds, and retaining textarea focus on pointer selection. No ChatInput prop/API edits.
- `MessageItem`: inline fixed image preview100 was still trapped by transcript stacking/overflow. Now uses shared accessible Dialog body portal with title, close button, Escape and overlay dismissal.
- `AddEditAssistant`: the emoji picker is a local child of Dialog, not a global overlay. Corrected `absolute!s` typo and replaced arbitrary local40 override with local10; it inherits the Dialog80 context rather than fighting it.
- `AppUpdater` and `PromptAnalytic`: nonmodal, fixed corner notice cards now portal to body at floating60. Deliberately not converted into modal dialogs or raised above modal sheets/toasts; no focus/consent behavior change.

### Retained local layers and visual gaps

- HeaderPage30 stays above global drag20. Sidebar/header/download buttons50 and download child wrappers40 are scoped contexts, not global menus; shared menu content portals independently. Caption controls and Linux resize grips60 are unchanged platform chrome; menus can tie them if collision placement reaches the titlebar, so native hit-testing still needs QA. Rail40 geometry avoids that strip.
- Sticky tool headings10, chain-of-thought scroll controls10, reasoning timeline10, draggable MCP rows0/10, model option20, and negative HomeModeToggle highlight are local ordering, intentionally not promoted globally.
- CoworkPage inline workspace completion list10 remains composer-local, unlike `@path` FilePickerPopover. It is not a global overlay; collision/clipping against narrow previews and dynamic composer heights remains a visual QA gap.
- Emoji picker remains inline within a scrollable Dialog; global z changes cannot cure potential clipping there. Fixing its geometry/portal would need an emoji-picker-specific positioning change, not a higher z-index.
- jsdom establishes portal ownership/classes/focus/Escape, not paint or pointer hit order. Native dark/light, animated rail transitions, phone safe areas, textarea scrolling and viewport-edge file-picker placement require visual QA. Image Dialog close-button contrast over bright images is another visual check.

### Feature validation

- Six focused suites passed **93 tests**: CoworkSidePanel7, CoworkOverviewPanel6, ModelCombobox32, MessageItem40, FilePickerPopover2, AddEditAssistant6. New cases cover phone titlebar bounds, panel tiers, modal-owned custom menus, body portal escape, file-picker coordinate conversion/selection and image-preview Escape dismissal.
- Final TypeScript build passed after all feature changes (`cd web-app && node node_modules/typescript/bin/tsc -b --pretty false`).
