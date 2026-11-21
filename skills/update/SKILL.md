---
name: update
description: Update the Session Observer plugin to the latest version and restart its dashboard server. Use when the user asks to update, upgrade or reinstall Session Observer, or says the dashboard shows an old version.
allowed-tools: Bash(claude plugin:*), Bash(node:*)
---
Update Session Observer, then restart its dashboard so the new version serves it.

1. Refresh the marketplace and update the plugin:
   ```
   claude plugin marketplace update session-observer-marketplace
   claude plugin update session-observer@session-observer-marketplace
   ```
2. If the update says the plugin is already at the latest version but the user wants the newest
   commit (an update is only picked up when the version changes), reinstall instead:
   ```
   claude plugin uninstall session-observer@session-observer-marketplace
   claude plugin install session-observer@session-observer-marketplace
   ```
3. Restart the dashboard server. The old server keeps running after an update until it is
   stopped; this stops it and starts the newest installed version:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/restart.js"
   ```
4. Report the version before and after, and the dashboard URL. Tell the user to restart Claude Code
   so the new hooks load (hooks are read at session start).

If a `claude plugin` command fails, show its output and stop; do not restart the server.
