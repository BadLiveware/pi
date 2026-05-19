# Browser Bridge

Private local Pi extension for bridging Pi to a companion browser extension.

The current build registers bridge state tooling, an explicit fixed-port local gateway lifecycle, a loadable companion browser extension shell, user-driven element selection, visible page overlays, local preview pages, bounded page interactions, and gated clipboard writes. It does not start a network listener on load.

## Current capabilities

- `/browser-bridge status` shows local bridge state and diagnostics; `/browser-bridge status debug` or `/browser-bridge debug` includes recent Pi-side debug log entries.
- `/browser-bridge start` starts a fixed-port gateway bound to `127.0.0.1:43871`.
- `/browser-bridge stop` stops the listener and disconnects clients.
- `/browser-bridge pair` starts the gateway if needed and opens a short-lived no-copy pairing window with a token fallback.
- `browser_bridge_state` returns structured state for the agent.
- Browser extension popup defaults to the fixed gateway URL, can connect during a Pi pairing window without copying a token, shows recent browser-side debug log entries, and explicitly activates the current tab.
- Activated tabs report title, origin, viewport, and capabilities back to Pi.
- `browser_bridge_select_elements` asks the browser extension to let the user select one or more visible elements and returns compact descriptors.
- `browser_bridge_overlay` shows, hides, clears, highlights, and draws visible annotations on activated tabs.
- `browser_bridge_open_preview` serves inline/workspace HTML through localhost or opens existing HTTP(S) URLs.
- `browser_bridge_interact` runs bounded click/type/scroll/key actions with confirmation defaults and no arbitrary JavaScript eval.
- `browser_bridge_clipboard` writes text to the clipboard through the activated browser tab, with confirmation enabled by default and no clipboard read support.
- The Pi extension loads without opening ports or requiring a browser extension to be installed.

## Safety posture

- The bridge listener is disabled by default.
- Browser clients must pair during a short-lived Pi pairing window or use the fallback token before registration.
- The listener binds only to `127.0.0.1`.
- Browser activation is explicit from the extension popup; content scripts are not injected into every page.
- Selection returns compact, capped descriptors; full HTML previews are opt-in and capped.
- Page interactions are limited to click, type, scroll, and key actions. There is no arbitrary JavaScript evaluation tool.
- Clipboard support is a separate write-only capability and asks for confirmation by default.
- No cookies, local storage, session storage, credentials, clipboard reads, or screenshots are collected by the MVP tools.

## Setup and pairing

1. Build the companion browser extension:

   ```bash
   cd agent/extensions
   npm run build:browser --workspace @badliveware/pi-browser-bridge
   ```

2. Load `agent/extensions/private/browser-bridge/browser-extension/` as an unpacked Chromium extension.
3. In Pi, run `/browser-bridge pair`.
4. In the browser extension popup, leave the default gateway URL and click **Connect / Pair**. Copying the displayed fallback pairing details is only needed if no-copy pairing fails.
5. After the first successful pair, the extension stores a session-scoped resume secret and can reconnect to the same Pi session without a new pairing token.
6. Open a normal `http:`, `https:`, or allowed `file:` page, then click **Activate current tab** in the popup.
7. In Pi, call `browser_bridge_state` to confirm the client and activated tab are visible.

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
8. Use `browser_bridge_clipboard` with a harmless test value and confirm the clipboard-write prompt.

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

- If `browser_bridge_state` shows no clients, run `/browser-bridge pair` and click **Connect / Pair** in the popup before the pairing window expires. Use `browser_bridge_state` with `includeDebugLog: true`, `/browser-bridge debug`, and the popup **Debug log** section to compare Pi-side and browser-side connection events.
- If the popup shows a stale non-default bridge URL, reload the unpacked extension; the popup should default back to `ws://127.0.0.1:43871`. Pasted fallback pairing details still override the URL for that attempt.
- If the extension disconnects after it was paired, reopen the popup and click **Connect** with the saved URL; a new token is not needed for the same Pi session. The background worker also attempts to reconnect automatically.
- If a tab does not appear in state, activate it from the popup after the page finishes loading.
- Restricted browser pages such as `chrome://` pages cannot be activated.
- If preview tabs do not open, copy the URL returned by `browser_bridge_open_preview` and open it manually.
- If a page interaction fails to find a target, select the element first and use its returned `elementId`, or use a stable selector from `selectorCandidates`.
