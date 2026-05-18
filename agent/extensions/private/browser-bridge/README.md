# Browser Bridge

Private local Pi extension for bridging Pi to a companion browser extension.

The current build registers bridge state tooling, an explicit local WebSocket listener lifecycle, a loadable companion browser extension shell, user-driven element selection, and visible page overlays. It does not start a network listener on load and does not provide preview pages or page control yet.

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
- The Pi extension loads without opening ports or requiring a browser extension to be installed.

## Safety posture

- The bridge listener is disabled by default.
- Browser clients must pair with a short-lived token before registration.
- The listener binds only to `127.0.0.1`.
- No page content, screenshots, cookies, storage, or form data are collected.
- Browser page control commands are not registered yet.

## Development validation

From the extension workspace:

```bash
cd agent/extensions
npm run check:structure
npm run typecheck
npm test
npm run build:browser --workspace @badliveware/pi-browser-bridge
```

To load the browser extension manually, run the build command and load `agent/extensions/private/browser-bridge/browser-extension/` as an unpacked extension.

## Planned capabilities

- Authenticated `127.0.0.1` bridge server with short-lived pairing tokens.
- Browser extension popup for pairing and explicit active-tab activation.
- Element selection with safe descriptors.
- Page overlay highlighting and drawing.
- Local preview pages for agent-created options.
- Bounded click/type/scroll interactions with confirmation policy.
