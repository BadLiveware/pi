# Browser Bridge

Private local Pi extension for bridging Pi to a companion browser extension.

The current build registers bridge state tooling and an explicit local WebSocket listener lifecycle. It does not start a network listener on load, install a browser extension, inject content scripts, or control pages.

## Current capabilities

- `/browser-bridge status` shows local bridge state and diagnostics.
- `/browser-bridge start` starts a listener bound to `127.0.0.1`.
- `/browser-bridge stop` stops the listener and disconnects clients.
- `/browser-bridge pair` starts the listener if needed and creates a short-lived pairing token.
- `browser_bridge_state` returns structured state for the agent.
- The extension loads without opening ports or requiring a browser extension to be installed.

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
```

## Planned capabilities

- Authenticated `127.0.0.1` bridge server with short-lived pairing tokens.
- Browser extension popup for pairing and explicit active-tab activation.
- Element selection with safe descriptors.
- Page overlay highlighting and drawing.
- Local preview pages for agent-created options.
- Bounded click/type/scroll interactions with confirmation policy.
