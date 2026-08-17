# Login UX Extension Design

## Goal

Make `/login` a low-friction provider picker for the existing TUI login system. The picker must support Codex, Claude, OpenCode, DeepSeek, and Tokamak without requiring users to choose a second authentication method before the natural flow starts.

This pass focuses on Codex first for verification, while preserving existing API-key login and logout behavior for every currently supported provider.

## User experience

### Provider picker

`/login` opens one picker using the existing catalog order:

1. Codex (`openai`)
2. Claude (`anthropic`)
3. OpenCode (`opencode`)
4. DeepSeek (`deepseek`)
5. Tokamak (`tokamak`)

Each row shows the display name, provider id, and either `signed in` or `not signed in`. Enter starts the provider flow directly. Esc closes the picker. A selected provider may be signed in again to replace or refresh its saved credential.

The provider picker remains the single source of navigation. The current provider-to-method picker is removed from the `/login` path because it makes account providers take an unnecessary extra step.

### Provider flows

- **Codex and Claude:** begin the existing PKCE browser flow, open the authorization URL, and wait for the loopback callback.
- **OpenCode:** show the provider API-key prompt and open the provider key page before input, using the existing masked-input behavior.
- **DeepSeek and Tokamak:** use the existing API-key prompt unchanged except for direct routing from the provider picker.

The flow is selected from typed provider capability data, not from display names or ad hoc string checks in the key handler.

### OAuth prompt

While Codex or Claude authentication is active, the prompt owns keyboard input and renders:

- the provider name;
- a short browser-authentication status;
- the authorization or callback instructions;
- a manual input field for a raw authorization code or complete redirect URL;
- `Enter` to submit manual input and `Esc` to cancel.

The browser callback remains the preferred path. Manual input is a fallback for terminals where the loopback redirect cannot reach the local process. The prompt is cleared after success or cancellation. A retryable failure leaves the prompt available with a safe error message and an empty input.

### Post-login model picker

`/model` opens a full-screen split picker instead of the current flat list:

- a left sidebar contains `All models` and one entry for each reachable
  provider, with the number of models in each scope;
- the right pane lists models in the active scope as `provider / model`;
- the current model is highlighted when the picker opens;
- typing filters the active scope using the existing multi-term matching
  behavior;
- the selected model's provider/model id and current/default state are shown
  below the list;
- Left/Right changes focus between the sidebar and model list, Up/Down moves
  within the focused pane, Enter selects the highlighted model, and Esc closes.

The picker reloads layered provider configuration each time it opens, so models
discovered during a successful account login appear immediately. It does not
invent context-window or pricing metadata that the local provider
configuration does not contain; known ids and current/default state are the
reliable minimum.

The sidebar is intentionally limited to model scopes in this pass. Role
assignment and role-management rows from the reference are not part of this
login and model-discovery change.

## Architecture

### Provider capability boundary

`src-tauri/src/core/cli/auth/mod.rs` remains the non-secret provider catalog. Account support continues to be represented by `account::AccountProvider`; API-key metadata remains in `ProviderDefinition`. TUI code may ask the typed catalog which flow to start but must not infer capabilities from labels.

No OAuth client secrets, PKCE verifier values, callback state values, API keys, or access tokens enter the picker state or rendered text.

### Account flow boundary

`src-tauri/src/core/cli/auth/account.rs` owns:

- provider-specific authorization URL construction;
- PKCE and state generation;
- loopback callback binding and validation;
- parsing a manually pasted callback URL or authorization code;
- token exchange, model discovery, and persistence.

The account module exposes a cancel-safe way for the TUI to race a valid manual callback input against the loopback callback. Invalid or state-mismatched manual input is ignored without persisting anything. Callback and manual paths share the same state validation and token exchange code.

### TUI boundary

`src-tauri/src/core/cli/tui.rs` owns only interaction state and task orchestration:

- picker selection and direct flow routing;
- the active OAuth prompt and its input buffer;
- sending manual callback input to the account task;
- aborting the task when Esc closes the prompt;
- building the `/model` provider scopes and model-list view from reachable
  provider configuration;
- rendering safe status and error text.

The render loop never performs network I/O. Account completion and API-key verification stay in background tasks and report typed outcomes back to the TUI.

## Data flow

1. User enters `/login`.
2. TUI builds the provider picker from `provider_catalog()` and computes each row's signed-in state.
3. User selects a provider.
4. TUI starts the direct flow:
   - account provider: call `account::begin`, set OAuth prompt state, then hand the login descriptor to the event loop;
   - API-key provider: open the existing masked API-key prompt.
5. The event loop starts one background task for the active flow.
6. For OAuth, the task binds the callback listener before opening the browser. It then waits for either a validated loopback callback or a manual callback input from the prompt.
7. The account module exchanges the code, discovers models, and persists credentials/configuration only after all validation succeeds.
8. TUI receives a non-secret success or failure result, clears or retains the prompt according to the result, and updates the transcript.
9. On success, the existing model-adoption behavior remains in effect and `/model` can select any discovered model.

10. User opens `/model`; TUI reloads reachable provider configs, groups model ids
    into provider scopes, and opens the split picker with the current model
    selected.
11. User selects a model; TUI updates the session model and closes the picker.

## Cancellation and stale-result rules

- Esc on an active OAuth prompt sets the active flag false, clears the pending descriptor and provider id, and aborts the background task on the next loop iteration.
- Esc on an API-key prompt retains the existing cancellation behavior.
- A late task result after cancellation must not produce a success or failure note.
- A new login cannot start while another login task is active. After cancellation, all pending login state is cleared before the picker can start another flow.
- Invalid manual input does not terminate the OAuth prompt and does not change stored credentials.
- Every error shown in the TUI is provider-scoped and non-secret. Raw callback values, authorization codes, token fields, client secrets, and credential persistence details are never rendered.

## Testing

Add or update focused tests in the existing Rust test modules:

- provider picker contains all five providers in the expected order and reports signed-in state;
- selecting Codex or Claude starts account login directly without a method picker;
- selecting OpenCode, DeepSeek, or Tokamak starts the API-key prompt directly;
- manual callback parsing accepts a raw code and redirect URL, rejects empty or state-mismatched input, and shares callback validation;
- OAuth cancellation clears active state and prevents late completion messages;
- OAuth success and failure retain the existing safe outcome and model guidance;
- API-key login behavior and `/logout` remain unchanged;
- `/model` groups all reachable models by provider, reports accurate counts,
  filters within the active scope, preserves the current selection, and updates
  the session model on Enter;
- provider model discovery from a successful login is visible the next time
  `/model` opens;
- account failures remain sanitized even when lower layers return callback or credential-like text.

Run the targeted Rust tests for `core::cli::auth` and `core::cli::tui`, then run the repository's relevant CLI check before delivery.

## Non-goals

- No new provider beyond Codex, Claude, OpenCode, DeepSeek, and Tokamak.
- No desktop login screen or web-app login flow.
- No credential-store migration or change to provider secret storage.
- No generic authentication framework for future device-code or enterprise flows.
- Role assignment and role-management UI are not included in this pass.
- No changes to model selection semantics, `/logout` syntax, or provider transport behavior.
