# Browser ↔ Pi Extension Bridge Plan

## Purpose

Build a local bridge between Pi and a companion browser extension so the agent can ask for user-visible browser context and act on it in controlled ways:

- let the user select one or more elements on the current web page
- let the agent draw visible annotations on top of a page
- let the agent open locally generated preview pages automatically
- let the agent perform bounded page interactions, with a path to DevTools-backed automation for inspection, screenshots, console/network data, and reliable actions

This is a bounded implementation plan for an internal MVP first. Public packaging can happen after the security model, pairing flow, and manual browser UX are proven.

## Observed facts

- Pi extensions can register tools, commands, lifecycle hooks, custom rendering, and user UI via `@earendil-works/pi-coding-agent`.
- Existing extension workspace is under `agent/extensions/` with workspaces `public/*` and `private/*`.
- `agent/extensions/package.json` already has `check:structure`, `typecheck`, `test`, and `pack:public` scripts.
- Project guidance prefers vertical-slice extension structure and keeping `index.ts` mostly registration and wiring.
- The drawer prototype at `../slides/src/plugins/drawer/` already implements a fixed canvas overlay, normalized coordinates, freehand/rect/arrow/eraser tools, stroke events, and public methods such as `addStroke`, `addStrokes`, `clearSlide`, `undo`, `show`, and `showReadOnly`.
- The drawer prototype is Reveal-specific: it assumes `.reveal .slides`, slide keys, and Reveal keybindings. Its stroke model and overlay mechanics are reusable, but page coordinate ownership and activation must be redesigned for arbitrary web pages.

## Scope

### MVP scope

1. Private Pi extension package at `agent/extensions/private/browser-bridge/`.
2. Companion Manifest V3 browser extension source under that package.
3. Local authenticated bridge server bound to `127.0.0.1`.
4. Agent tools for bridge state, element selection, overlay drawing/highlighting, local preview pages, and bounded interactions.
5. Browser content scripts for selection mode, element descriptors, and overlay drawing.
6. Manual validation fixture page and documented load/run flow.
7. Tests for protocol validation, state transitions, selector derivation helpers, preview path safety, and tool behavior without requiring a real browser.

### Deferred scope

- Publishing as a public Pi package.
- Cross-browser support beyond Chromium-compatible browsers.
- Arbitrary JavaScript evaluation from Pi.
- Full cross-origin iframe inspection.
- Persistent page annotations across browser restarts.
- Incognito support.
- Remote browser control over non-local networks.

## Non-goals and safety boundaries

- Do not enable blanket `<all_urls>` page access in the MVP. Prefer manual per-tab activation via the browser extension action and optional host grants only after MVP validation.
- Do not surface full DOM, screenshots, cookies, local storage, form values, or page-sensitive text unless the tool request explicitly asks for that data.
- Do not add arbitrary eval as a general tool. If a future debug tool needs evaluated JavaScript, gate it behind explicit user confirmation and mark it as high risk.
- Do not start a long-lived bridge listener unless the user enables the bridge or an agent tool explicitly requests it.
- Do not make the browser extension trust any localhost server without token pairing.

## Architecture decision

### Chosen shape

Use a Pi extension as the source of truth for agent tools, state, pairing, and preview serving. Use a browser extension for user-visible page capabilities that DevTools alone does not provide well: element selection, hover highlighting, drawing overlays, labels, and page-local event handling. Keep DevTools/CDP as a separate optional backend for automation and diagnostics rather than forcing all browser work through content scripts.

```text
Pi tool / command
  -> private/browser-bridge Pi extension
  -> local 127.0.0.1 bridge server with token pairing
  -> browser extension background worker
  -> active tab content script
  -> DOM selection, overlay drawing, bounded page actions
```

### Why this shape

- Pi tools give the agent structured, auditable entry points instead of free-form browser scripting.
- A browser extension can draw and select in the user’s real page, which CDP cannot make user-friendly by itself.
- A local bridge keeps credentials and page data local.
- Separating content-script capabilities from DevTools capabilities avoids one unsafe “do anything in the page” tool.
- A private-first package lets the design settle before public README, packaging, and compatibility promises.

### Rejected alternatives

- **Pi-only DevTools integration:** good for automation, screenshots, console, and network inspection, but weak for user-driven element selection and visible drawing overlays.
- **Browser extension only with no Pi extension:** cannot expose agent-operable tools, session diagnostics, or preview serving through Pi’s normal extension patterns.
- **Native messaging first:** stronger installation-time trust boundary, but higher setup cost and worse MVP iteration speed than a loopback server with pairing.
- **Directly reuse the drawer plugin unchanged:** the drawer is tied to Reveal slide coordinates and lifecycle. Reuse its stroke concepts and interaction patterns, not its slide ownership.

## Data and protocol shape

### Bridge state

The Pi extension owns durable session-facing state:

```ts
type BridgeState = {
  server: {
    enabled: boolean;
    host: "127.0.0.1";
    port?: number;
    pairedClientCount: number;
    diagnostics: string[];
  };
  clients: BrowserClient[];
  tabs: BrowserTab[];
  pendingRequests: PendingBridgeRequest[];
  previewServer?: PreviewServerState;
};
```

Browser extension owns browser-local state:

```ts
type BrowserClientState = {
  clientId: string;
  browser: "chrome" | "edge" | "chromium" | "unknown";
  extensionVersion: string;
  activeTabId?: number;
  activatedTabs: Record<number, TabCapabilityState>;
};
```

### Message envelope

All bridge messages use a versioned request/response envelope:

```ts
type BridgeEnvelope = {
  version: 1;
  id: string;
  requestId?: string;
  direction: "pi-to-browser" | "browser-to-pi";
  type: string;
  target?: { tabId?: number; frameId?: number };
  payload: unknown;
};
```

Rules:

- Pi extension validates message shape before dispatch.
- Browser extension validates command type and target tab before content-script dispatch.
- Requests have timeouts and cancellation handling.
- Tool results return compact summaries to the LLM and richer structured `details` for debug/rendering.
- Large DOM/html/screenshot data is capped and stored in temp/session artifacts with paths in the result.

### Element descriptor

The content script returns descriptors rather than live DOM references:

```ts
type ElementDescriptor = {
  elementId: string; // ephemeral per tab/content-script session
  selectorCandidates: string[];
  tagName: string;
  role?: string;
  accessibleName?: string;
  textPreview?: string;
  attributes: Record<string, string>;
  boundingBox: { x: number; y: number; width: number; height: number; coordinateSpace: "viewport" };
  htmlPreview?: string;
};
```

The agent uses descriptors for discussion, highlighting, and bounded interactions. The content script can resolve `elementId` only while the page/script session remains valid; selectors are used as fallback after reload.

### Overlay stroke model

Adapt the drawer stroke model to arbitrary pages:

```ts
type OverlayCommand =
  | { action: "clear"; layer?: string }
  | { action: "highlight"; elementId?: string; selector?: string; label?: string; color?: string }
  | { action: "draw"; layer?: string; strokes: OverlayStroke[] }
  | { action: "show" | "hide" };

type OverlayStroke =
  | { type: "freehand"; points: Point[]; color: string; size: number; coordinateSpace: "viewport" | "document" }
  | { type: "rect"; start: Point; end: Point; color: string; size: number; coordinateSpace: "viewport" | "document" }
  | { type: "arrow"; start: Point; end: Point; color: string; size: number; coordinateSpace: "viewport" | "document" };
```

MVP uses viewport coordinates for visible annotations and recomputes element bounding boxes before drawing highlights. Document coordinates can be added once scroll persistence is needed.

## Agent-facing tools

### `browser_bridge_state`

Read-only. Returns server status, connected clients, active/activated tabs, capabilities, pending requests, and diagnostics.

Validation:

- With no browser extension connected, returns `enabled`, `port`, zero clients, and a clear pairing hint.
- With a connected browser extension, shows client id, browser kind, extension version, and tab capability summaries without leaking full URLs if configured for privacy.

### `browser_bridge_select_elements`

Starts selection mode in a target tab and waits for user completion.

Parameters:

```ts
{
  target?: { tabId?: number; active?: boolean };
  mode: "single" | "multiple";
  includeHtml?: boolean;
  includeText?: boolean;
  maxHtmlChars?: number;
  timeoutMs?: number;
}
```

Behavior:

- Content script displays hover outline and small instruction banner.
- User clicks elements, presses Enter to finish, Escape to cancel.
- Tool returns descriptors and a compact summary.
- If the active tab has not been activated, tool returns an actionable message instructing the user to click the browser extension action for the current tab.

### `browser_bridge_overlay`

Controls visible page overlays.

Parameters:

```ts
{
  target?: { tabId?: number; active?: boolean };
  commands: OverlayCommand[];
  persistForSession?: boolean;
}
```

Behavior:

- Supports show/hide/clear/highlight/draw in one ordered call.
- Highlights selected descriptors by `elementId` or selector.
- Draws arrows/rectangles/freehand strokes using the adapted drawer overlay.

### `browser_bridge_open_preview`

Creates or opens a local page for agent-generated options.

Parameters:

```ts
{
  title?: string;
  html?: string;
  path?: string;
  url?: string;
  mode?: "new-tab" | "reuse-preview-tab";
  allowPageToReportChoice?: boolean;
}
```

Behavior:

- For `html`, writes a session-scoped preview artifact under a browser-bridge preview directory and serves it over the local preview server.
- For `path`, normalizes a leading `@`, resolves under `ctx.cwd`, rejects paths outside the workspace unless explicitly allowed by a future setting, and serves via localhost instead of relying on `file://` permissions.
- Opens through the connected browser extension when available; otherwise returns a localhost URL and a command users can open manually.
- Optional choice-reporting injects a tiny script that can send a selected variant id back through the bridge.

### `browser_bridge_interact`

Bounded page interactions. This is not an eval tool.

Parameters:

```ts
{
  target?: { tabId?: number; active?: boolean };
  actions: Array<
    | { type: "click"; elementId?: string; selector?: string; x?: number; y?: number }
    | { type: "type"; elementId?: string; selector?: string; text: string; clearFirst?: boolean }
    | { type: "scroll"; x?: number; y?: number; behavior?: "instant" | "smooth" }
    | { type: "key"; key: string }
  >;
  requireUserConfirmation?: boolean;
}
```

Behavior:

- Defaults to requiring confirmation for text entry, keyboard shortcuts, and multi-action sequences.
- Returns per-action result summaries with element resolution status.
- Does not expose cookies, storage, or arbitrary script execution.

### Optional later tool: `browser_bridge_devtools`

A separate capability for CDP/DevTools-backed inspection. It can support screenshots, console logs, network summaries, accessibility tree snapshots, and robust automation. This should be designed after the MVP content-script bridge is working, so the tool boundary can reflect real needs.

## Commands and UI

### `/browser-bridge status`

Shows server status, pairing state, connected clients, and activation instructions.

### `/browser-bridge start`

Starts the loopback bridge server and preview server if they are not running.

### `/browser-bridge stop`

Stops bridge listeners, disconnects clients, and clears transient pairing tokens.

### `/browser-bridge pair`

Starts the server if needed and displays a short-lived token plus connection instructions for the browser extension popup.

### Browser extension popup

Popup states:

1. Not configured: ask for Pi bridge URL and token.
2. Connected: show Pi session name/port and connection health.
3. Current tab not activated: button to activate current tab for Pi.
4. Current tab activated: show allowed capabilities and disconnect button.

## File and package layout

```text
agent/extensions/private/browser-bridge/
  package.json
  index.ts
  README.md
  src/
    core/
      protocol.ts
      state.ts
      errors.ts
      ids.ts
    bridge-server/
      lifecycle.ts
      websocket.ts
      pairing.ts
      request-router.ts
    preview/
      preview-server.ts
      preview-artifacts.ts
    slices/
      state-tool/
      select-elements/
      overlay/
      open-preview/
      interact/
      commands/
    test-support/
      fake-browser-client.ts
  browser-extension/
    manifest.json
    package.json or build config if kept separate
    src/
      background.ts
      popup.html
      popup.ts
      content/
        index.ts
        selector-mode.ts
        overlay-canvas.ts
        element-descriptors.ts
        page-actions.ts
      shared/
        protocol.ts
        limits.ts
    dist/ or build/
  test/
    protocol.test.ts
    state-tool.test.ts
    select-elements.test.ts
    overlay-model.test.ts
    preview-server.test.ts
    interact.test.ts
```

Notes:

- Keep `index.ts` limited to loading config, creating shared state, registering commands/tools, and lifecycle cleanup.
- Keep each slice’s tool schema, formatter, browser message mapping, and tests near that slice.
- Share protocol types via a small generated/copied `shared/protocol.ts` for the browser extension build. Avoid importing Node-only Pi extension modules into browser code.
- Add runtime dependencies such as `ws` to the browser-bridge package `dependencies`, not only root dev dependencies.

## Execution plan

### Slice 1 — Package scaffold and inert Pi extension

Goal: create the private package without starting network listeners by default.

Implementation tasks:

1. Create `agent/extensions/private/browser-bridge/package.json` with package metadata, local scripts, runtime dependencies, and `pi.extensions: ["./index.ts"]`.
2. Add `index.ts` that registers `/browser-bridge status` and `browser_bridge_state` with an inert state object.
3. Add package to the workspace discovery path in `agent/extensions/package.json` only if the extension remains no-op until start/pair/tool activation.
4. Add minimal README with local development setup and security posture.

Acceptance criteria:

- `/browser-bridge status` works after loading the extension.
- `browser_bridge_state` reports disabled/no clients/no listener and no crashes.
- Extension load does not open a port until explicitly requested.

Validation:

```bash
cd agent/extensions
npm run check:structure
npm run typecheck
npm test
```

Expected signal: all commands exit 0; new files do not trip structure guards.

### Slice 2 — Protocol, pairing, and bridge server lifecycle

Goal: establish a local authenticated request/response channel between Pi and one or more browser clients.

Implementation tasks:

1. Implement versioned envelope parsing, validation, request ids, timeouts, and typed error responses.
2. Implement `/browser-bridge start`, `/browser-bridge stop`, and `/browser-bridge pair`.
3. Start a `127.0.0.1` WebSocket server only on command/tool demand.
4. Require a short-lived pairing token on first client connection.
5. Store connected client summaries in runtime state and expose them through `browser_bridge_state`.
6. Cleanly close sockets and timers on `session_shutdown`.
7. Add fake-client tests for successful pair, bad token rejection, timeout, disconnect cleanup, and shutdown cleanup.

Acceptance criteria:

- A fake browser client can pair and exchange a ping/capabilities message.
- Bad tokens fail without registering a client.
- The server can stop and restart in one session.
- Shutdown cleanup leaves no listener open.

Validation:

```bash
cd agent/extensions
npm run typecheck
node --experimental-strip-types --test private/browser-bridge/test/protocol.test.ts private/browser-bridge/test/bridge-server.test.ts
```

Expected signal: tests exit 0 and include pair/reject/timeout/shutdown cases.

### Slice 3 — Browser extension shell and active-tab activation

Goal: ship a loadable companion extension that can connect to Pi and activate the current tab.

Implementation tasks:

1. Add Manifest V3 browser extension files with permissions `activeTab`, `scripting`, `tabs`, and localhost bridge host permissions.
2. Add background worker bridge client with reconnect handling and capability announcement.
3. Add popup UI for entering bridge URL/token, showing connection status, and activating the current tab.
4. Add content-script injection for activated tabs.
5. Add a content-script handshake that reports URL origin, title, viewport size, and supported capabilities.
6. Avoid injecting on restricted schemes such as `chrome://`, extension pages, the Chrome Web Store, and browser PDF viewer pages.

Acceptance criteria:

- User can load the unpacked extension.
- User can pair it with `/browser-bridge pair`.
- `browser_bridge_state` shows connected client and activated tab after popup activation.
- Restricted pages return clear unsupported-page diagnostics.

Validation:

```bash
cd agent/extensions/private/browser-bridge
npm run build:browser
cd ../..
npm run typecheck
```

Manual browser validation:

1. Load the built browser extension directory as an unpacked extension.
2. Run `/browser-bridge pair` in Pi and enter the URL/token in the popup.
3. Open a normal local fixture page, click the extension action, and activate the tab.
4. Call `browser_bridge_state` and verify the active tab appears with capabilities.

### Slice 4 — Element selection

Goal: let the agent ask the user to select elements and receive safe descriptors.

Implementation tasks:

1. Add `browser_bridge_select_elements` tool schema, timeout handling, and result formatting.
2. Implement content-script selection overlay: hover outline, clicked selection state, instruction banner, Enter finish, Escape cancel.
3. Implement descriptor extraction with selector candidates, role/name where available, bounding box, text preview, attributes, and optional html preview capped by `maxHtmlChars`.
4. Add selector derivation helpers that prefer stable ids/test ids/aria labels before brittle positional selectors.
5. Add tests for descriptor trimming, selector candidate ordering, cancellation, timeout, and activation-required error.

Acceptance criteria:

- Single-select returns one descriptor and clears selection UI.
- Multi-select returns multiple descriptors in click order.
- Escape returns a cancelled result without stale overlay state.
- The tool refuses inactive tabs with an instruction that the user can act on.

Validation:

```bash
cd agent/extensions
npm run typecheck
node --experimental-strip-types --test private/browser-bridge/test/select-elements.test.ts
```

Manual browser validation:

1. Open the fixture page.
2. Activate the tab from the browser extension popup.
3. Ask the agent to select one element.
4. Select a button or form control.
5. Verify the tool result includes descriptor fields and no uncapped full-page DOM dump.

### Slice 5 — Overlay drawing and highlighting

Goal: let the agent visibly draw boxes, arrows, labels, and highlights on the active page.

Implementation tasks:

1. Adapt the drawer overlay into a content-script-owned `overlay-canvas.ts` that is independent of Reveal.
2. Use viewport coordinate space for MVP drawing.
3. Add element highlighting by `elementId` and selector, resolving current bounding boxes before each draw.
4. Implement `show`, `hide`, `clear`, `highlight`, and `draw` commands in `browser_bridge_overlay`.
5. Keep overlay pointer-events disabled except when user drawing mode is explicitly active in a future slice.
6. Add tests for overlay command normalization and draw model validation.

Acceptance criteria:

- Agent can highlight a previously selected element.
- Agent can draw a rectangle and arrow in the visible viewport.
- Clear removes bridge-owned overlay content without modifying the page DOM outside the overlay container.
- Resize/scroll followed by highlight recomputes element position.

Validation:

```bash
cd agent/extensions
npm run typecheck
node --experimental-strip-types --test private/browser-bridge/test/overlay-model.test.ts
```

Manual browser validation:

1. Select an element with `browser_bridge_select_elements`.
2. Call `browser_bridge_overlay` to highlight it and draw an arrow.
3. Resize the browser and call highlight again.
4. Verify the annotation follows the element’s current visible position.

### Slice 6 — Local preview pages

Goal: let the agent show locally generated web pages and option boards automatically.

Implementation tasks:

1. Implement a preview artifact directory under a session/workspace-scoped browser-bridge directory.
2. Implement a localhost preview server with path normalization and workspace-safe file serving.
3. Add `browser_bridge_open_preview` for inline HTML, workspace paths, and existing URLs.
4. Add browser-extension command to open or reuse a preview tab.
5. Add optional choice-reporting script for preview pages with explicit `allowPageToReportChoice`.
6. Add tests for path normalization, traversal rejection, HTML artifact creation, and preview URL generation.

Acceptance criteria:

- Agent can create an inline HTML option page and open it in a new tab.
- Agent can open a workspace HTML file through localhost.
- Path traversal outside the allowed root is rejected.
- Choice-reporting returns a variant id to Pi only when explicitly enabled.

Validation:

```bash
cd agent/extensions
npm run typecheck
node --experimental-strip-types --test private/browser-bridge/test/preview-server.test.ts
```

Manual browser validation:

1. Ask the agent to create a two-option preview page.
2. Verify the page opens in the connected browser.
3. If choice reporting is enabled, click an option and verify Pi receives the selected id.

### Slice 7 — Bounded page interaction

Goal: provide safe click/type/scroll/key actions without arbitrary eval.

Implementation tasks:

1. Add `browser_bridge_interact` tool with ordered action list and result per action.
2. Implement content-script resolution by `elementId`, selector, or viewport coordinates.
3. Require confirmation for text entry, keyboard shortcuts, and multi-action sequences unless the tool request explicitly opts into a lower-risk single click.
4. Return action result summaries with element resolution failures and page-side exceptions.
5. Add tests for confirmation policy, selector resolution request construction, and per-action error aggregation.

Acceptance criteria:

- Agent can click a selected element.
- Agent can type into a selected input after confirmation.
- Failed selector resolution reports a clear action-level failure and does not execute later actions unless configured to continue.
- No arbitrary JS execution is available through this tool.

Validation:

```bash
cd agent/extensions
npm run typecheck
node --experimental-strip-types --test private/browser-bridge/test/interact.test.ts
```

Manual browser validation:

1. Open fixture page with an input and button.
2. Select the input.
3. Ask the agent to type a short value.
4. Confirm the action and verify the field updates.
5. Ask the agent to click the button and verify the fixture page records the click.

### Slice 8 — Diagnostics, docs, and linked layout

Goal: make the MVP maintainable and safe to operate.

Implementation tasks:

1. Expand README with setup, pairing, activation, security model, troubleshooting, and manual validation workflow.
2. Add `browser_bridge_state` diagnostics for disconnected clients, stale tabs, unsupported pages, last bridge error, and preview server status.
3. Add a small fixture HTML page for manual smoke validation.
4. Add extension skill only if natural-language operation needs extra instructions beyond tool descriptions.
5. Run the linking script if the extension is intended to be active in the live global agent layout.
6. Verify symlink state after linking.

Acceptance criteria:

- A future agent can load the README and run the manual smoke flow without guessing.
- State output points to the next corrective action for common failures.
- The live `~/.pi/agent` layout remains symlink-managed by this repository.

Validation:

```bash
cd agent/extensions
npm run check:structure
npm run typecheck
npm test
cd ../..
./link-into-pi-agent.sh
find ~/.pi/agent/extensions -maxdepth 3 -type l -ls | rg 'browser-bridge|extensions'
```

Expected signal: automated commands exit 0; symlink output shows managed paths pointing into this repository when the extension is linked.

## Validation matrix

| Capability | Automated validation | Manual/browser validation |
| --- | --- | --- |
| Extension loads inertly | typecheck, state-tool test | `/browser-bridge status` after `/reload` |
| Pairing | fake-client server tests | Browser popup connects with token |
| Active tab activation | state transition tests | Popup activates current tab |
| Element selection | selector/timeout/cancel tests | Select one and many elements on fixture page |
| Overlay drawing | overlay model tests | Highlight selected element and draw arrow |
| Preview pages | path/artifact tests | Open generated option page and report choice |
| Page interaction | policy/action tests | Type into fixture input and click button |
| Cleanup | shutdown tests | `/browser-bridge stop` disconnects cleanly |

## Performance shape

Scaling variables:

- connected clients and tabs
- pending bridge requests
- descriptor size from selected elements
- overlay stroke count
- preview artifact count and file sizes
- browser extension reconnect frequency

Bounds:

- cap selected element count by tool parameter with a conservative default
- cap text/html previews and write oversized details to artifacts
- timeout every bridge request
- clear stale pending requests on disconnect
- keep overlay stroke arrays bounded per layer and expose clear/replace commands
- serve preview artifacts from a session/workspace directory with cleanup guidance
- avoid continuous polling; use WebSocket events and explicit state reads

Representative validation:

- automated tests for request timeout and stale pending cleanup
- manual selection of multiple elements on a realistic page to verify result size remains compact
- manual overlay clear after repeated draw calls to verify UI remains responsive

## Risk register

| Risk | Mitigation |
| --- | --- |
| Browser service worker sleeps and drops bridge connection | Reconnect on popup/action/open events; Pi state reports stale clients; commands return activation-required or reconnect-required messages. |
| ActiveTab permission does not allow fully automatic injection | MVP uses explicit popup activation; later optional host permissions can reduce friction. |
| Cross-origin iframes cannot be inspected by the top content script | Report frame limitations in descriptors and state; defer frame-specific injection to a later slice. |
| Overlay coordinates drift on scroll/zoom | MVP recomputes highlights from element bounding boxes; viewport strokes are documented as viewport-relative. |
| Page data leakage into agent context | Default descriptors are compact; full HTML/text/screenshot data is opt-in and capped. |
| Localhost bridge accepts unwanted clients | Bind to `127.0.0.1`, require short-lived token pairing, store allowed client identity, reject unpaired messages. |
| Tool becomes a stealth browser automation/eval surface | Keep `interact` bounded; do not add arbitrary eval in MVP; require confirmation for high-impact actions. |
| Extension package becomes too large or single-file | Enforce vertical slices and run `check:structure`. |

## Rollback and compatibility

- The MVP is private and can be removed from `agent/extensions/package.json` if it causes startup or runtime issues.
- Bridge server starts only on explicit action, so disabling commands/tools or removing the package should not affect normal Pi sessions.
- Browser extension is companion-only; uninstalling it leaves the Pi extension in a disconnected but safe state.
- Preview artifacts live under a dedicated browser-bridge directory and can be deleted without affecting source files.

## Final acceptance criteria for MVP

- Pi can pair with the browser extension through a local authenticated bridge.
- Pi can show connected browser/tab state to the agent.
- The user can activate a tab and select element(s), and the agent receives safe descriptors.
- The agent can highlight/draw on the active page using the overlay.
- The agent can open a locally generated preview page automatically.
- The agent can perform at least click, type, and scroll with bounded schemas and confirmation policy.
- Automated extension tests and typecheck pass.
- Manual fixture-page smoke validation passes end-to-end.
- README documents setup, permissions, security model, and troubleshooting.
