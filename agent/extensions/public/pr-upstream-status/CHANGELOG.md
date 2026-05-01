# Changelog

## 0.2.0

- Changed PR auto-solve to use Pi custom messages so queued work has structured details and a compact renderer.
- Deferred auto-solve while Pi is busy, showing pending feedback/check state until the agent can safely be notified.
- Improved `/pr-autosolve now` so it can run a one-shot solve even when auto-solve is off or checks are still in progress.
- Added CI failure context to auto-solve prompts once failures are available.
- Summarized review-bot feedback bodies to reduce prompt noise while preserving actionable title, severity, description, location, and URL details.
- Updated README guidance for pending auto-solve behavior and custom message details.

## 0.1.1

- Initial public package release for PR status and auto-solve monitoring.
