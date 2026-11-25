# Security policy

## Supported versions

Only the latest release gets security fixes. Update with `/session-observer:update` or reinstall the plugin.

## Reporting a vulnerability

Do not open a public issue. Report it privately through
[GitHub's private vulnerability reporting](https://github.com/radekwojpl2/session-observer/security/advisories/new).
Include the version, steps to reproduce and the impact you expect.

You should get a reply within a week. Once a fix is released, the advisory is published and you are credited,
unless you ask not to be.

## Scope

Session Observer runs only on your machine. The hook writes session events to `~/.claude/session-observer/`,
and the dashboard server listens on `127.0.0.1` unless you set `OBSERVER_HOST`. Issues that matter most here:

- the server reachable from outside localhost in the default setup, or readable by another web page (CORS, DNS rebinding);
- the dashboard running script from session content (XSS through prompts, tool output or file names);
- the hook or server reading or writing files outside their own folders;
- secrets from sessions sent anywhere off the machine.
