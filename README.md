## Commit Timesheet Helper (VS Code)

Quick, zero-build extension that shows your last N days of commits grouped by day, with copy buttons for hashes, subjects, and a day summary (timesheet-friendly).

### How to run locally

1) Open this folder in VS Code.
2) Press `F5` (uses the `Run Extension` launch config).
3) Run the command “Commit Timesheet: Open Viewer”.

### Settings
- `commitTimesheet.daysBack` (default 30) — how far back to query `git log`.
- `commitTimesheet.author` (optional) — git author filter. If unset, falls back to `git config user.name`.

### Notes
- Uses `git log --since` with `%h|%cI|%s|%an` parsing and runs in the first workspace folder.
- Vue is loaded from the CDN in the webview; everything else is inline.
- Clipboard operations are handled through the VS Code host (no browser permissions needed).
