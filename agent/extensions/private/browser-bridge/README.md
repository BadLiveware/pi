# Browser Bridge

Private local Pi extension for bridging Pi to a companion browser extension.

The first build is intentionally inert: it registers a status command and a read-only state tool, but it does not start a network listener, pair browser clients, inject content scripts, or control pages. Future slices will add the loopback bridge server and browser extension.

## Current capabilities

- `/browser-bridge status` shows local bridge state and diagnostics.
- `browser_bridge_state` returns structured state for the agent.
- The extension loads without opening ports or requiring a browser extension to be installed.

## Safety posture

- The bridge listener is disabled by default.
- No browser clients can connect in the current build.
- No page content, screenshots, cookies, storage, or form data are collected.
- Browser control and pairing commands are not registered yet.

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
