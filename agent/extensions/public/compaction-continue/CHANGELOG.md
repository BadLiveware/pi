# Changelog

## 0.1.2

- Added idle watchdog recovery for stalled Ralph turns where the assistant says it will continue but does not call `ralph_done`.
- Improved compaction recovery so nudges are deferred while Pi is busy and only sent when Pi is idle with no queued messages.
- Tightened recovery prompts to tell the agent to stop when work is already complete instead of inventing more work.
- Updated status/help text to describe watchdog behavior for both compaction and Ralph idle recovery.

## 0.1.1

- Initial public package release for idle compaction continuation.
