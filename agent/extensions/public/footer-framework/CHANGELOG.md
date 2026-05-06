# Changelog

## 0.2.2

- Fixed custom footer rendering so layouts with all visible items on line 1 render as a single footer line instead of reserving an empty second line.

## 0.2.1

- Fixed footer rendering with cell-buffer composition so ANSI styling, OSC8 hyperlinks, grapheme clusters, wide characters, and overlays preserve terminal cell alignment.
- Improved diagnostics for rendered footer layout and right/center overlay behavior.
- Hardened footer line clearing so overwriting wide-character runs does not leave stale continuation cells.

## 0.2.0

- Added TypeScript render config support.
- Simplified footer framework configuration and generalized framework-owned layout behavior.
- Added adapter templates and built-in footer data source adaptation.

## 0.1.1

- Initial public package release.
