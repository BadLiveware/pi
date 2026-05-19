# Browser Bridge

Private local Pi extension for bridging Pi to a companion browser extension.

The current build registers bridge state tooling, an explicit local WebSocket listener lifecycle, a loadable companion browser extension shell, user-driven element selection, visible page overlays, local preview pages, and bounded page interactions. It does not start a network listener on load.

## Current capabilities

- `/browser-bridge status` shows local bridge state and diagnostics.
- `/browser-bridge start` starts a listener bound to `127.0.0.1`.
- `/browser-bridge stop` stops the listener and disconnects clients.
- `/browser-bridge pair` starts the listener if needed and creates a short-lived pairing token.
- `browser_bridge_state` returns structured state for the agent.
- Browser extension popup can connect with the URL/token and explicitly activate the current tab.
- Activated tabs report title, origin, viewport, and capabilities back to Pi.
- `browser_bridge_select_elements` asks the browser extension to let the user select one or more visible elements and returns compact descriptors.
- `browser_bridge_overlay` shows, hides, clears, highlights, and draws visible annotations on activated tabs.
- `browser_bridge_open_preview` serves inline/workspace HTML through localhost or opens existing HTTP(S) URLs.
- `browser_bridge_interact` runs bounded click/type/scroll/key actions with confirmation defaults and no arbitrary JavaScript eval.
- The Pi extension loads without opening ports or requiring a browser extension to be installed.

## Safety posture

- The bridge listener is disabled by default.
- Browser clients must pair with a short-lived token before registration.
- The listener binds only to `127.0.0.1`.
- Browser activation is explicit from the extension popup; content scripts are not injected into every page.
- Selection returns compact, capped descriptors; full HTML previews are opt-in and capped.
- Page interactions are limited to click, type, scroll, and key actions. There is no arbitrary JavaScript evaluation tool.
- No cookies, local storage, session storage, credentials, or screenshots are collected by the MVP tools.

## Setup and pairing

1. Build the companion browser extension:

   ```bash
   cd agent/extensions
   npm run build:browser --workspace @badliveware/pi-browser-bridge
   ```

2. Load `agent/extensions/private/browser-bridge/browser-extension/` as an unpacked Chromium extension.
3. In Pi, run `/browser-bridge pair`.
4. Copy the displayed **Pairing details** line into the extension popup and click **Connect**. You can also fill the bridge URL and pairing token separately; the popup persists draft fields if it closes while you copy the other value.
5. Open a normal `http:`, `https:`, or allowed `file:` page, then click **Activate current tab** in the popup.
6. In Pi, call `browser_bridge_state` to confirm the client and activated tab are visible.

## Manual smoke validation

The fixture page is at `fixtures/manual-smoke.html`.

Suggested smoke flow:

1. Build and load the browser extension.
2. Pair it with `/browser-bridge pair`.
3. Open `fixtures/manual-smoke.html` in the browser and activate the tab from the popup.
4. Use `browser_bridge_select_elements` in `single` mode and select the Alpha card or input.
5. Use `browser_bridge_overlay` to highlight the selected descriptor and draw an arrow or rectangle.
6. Use `browser_bridge_open_preview` with inline HTML and verify a new preview tab opens.
7. Use `browser_bridge_interact` to type into `#fixture-input` and click `#fixture-button`; confirm the in-page prompt when shown.

## Development validation

From the extension workspace:

```bash
cd agent/extensions
npm run check:structure
npm run typecheck
npm test
npm run build:browser --workspace @badliveware/pi-browser-bridge
```

## Troubleshooting

- If `browser_bridge_state` shows no clients, run `/browser-bridge pair` and reconnect from the popup before the token expires.
- If the popup closes while copying pairing values, reopen it; the URL/token draft fields are restored from extension-local storage.
- If a tab does not appear in state, activate it from the popup after the page finishes loading.
- Restricted browser pages such as `chrome://` pages cannot be activated.
- If preview tabs do not open, copy the URL returned by `browser_bridge_open_preview` and open it manually.
- If a page interaction fails to find a target, select the element first and use its returned `elementId`, or use a stable selector from `selectorCandidates`.
