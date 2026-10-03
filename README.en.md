# dsh-ExitOnClose

[中文](README.md) | English

DeepSeek Harness Desktop answers the window close button by hiding the window in
the system tray, and nothing in the application changes that. This plugin makes
the close button quit instead:

```text
before   click ×  ->  window hides, tray icon stays, DSH keeps running
after    click ×  ->  window closes, every DSH process is gone
```

Install it and it is active; no configuration is needed.

## Install

On the desktop application's **Plugins** page, paste this repository's GitHub
link:

```text
https://github.com/xia0x1/dsh-ExitOnClose
```

From a terminal — a `#` suffix pins a branch or tag:

```powershell
dsh plugin --profile desktop add https://github.com/xia0x1/dsh-ExitOnClose
dsh plugin --profile desktop add https://github.com/xia0x1/dsh-ExitOnClose#v0.1.0
```

For local development, use the checkout path instead of the link.

Its only dependency, `koffi`, ships prebuilt binaries and runs no install script,
so installation never trips pnpm's build-script approval.

## Suspend and uninstall

- **Suspend**: turn `dsh-exit-on-close` off on the Plugins page.
- **Uninstall**: click `dsh-exit-on-close` on the Plugins page and remove it.

## Behaviour

- **Close button** ends the Electron shell and its whole process tree, including
  the Host process this plugin runs in. Window, tray icon, agent turns,
  background jobs and terminal subprocesses all go at once.
- **This is termination, not a graceful quit.** Sessions, attachments and logs
  already on disk are kept (DSH persists as it goes); in-flight model output and
  running subprocesses are lost.
- **Windows desktop only.** Other platforms, and the browser `dsh web`, are not
  supported yet.
- The first close may show DSH's own one-time "tasks will continue, reopen from
  the tray" notice; after confirming it once, it never appears again.

## How it works

The desktop application is two processes: an Electron shell that handles the
close button, and a Host child process that runs plugins. The shell accepts only
a fixed set of IPC messages, so a plugin cannot ask it to quit, and the button is
a native window control that the page cannot observe. The window itself is the
one boundary that can be watched: every 250 ms the plugin asks Windows whether
the application's own top-level windows are still visible, and acts on the single
transition "was on screen, now all invisible" by terminating the shell, then its
process tree, then itself. Polling instead of a Win32 hook keeps no state that
something else would have to release later.

## Development

```text
src/index.js         the plugin: mount, lifecycle, and what a close does
src/desktop.js       Win32 layer: window observation and process-tree termination
src/process-tree.js  pure process relationships, no OS or Node APIs
test/                unit tests for the pure rules
tools/dry-run.mjs    manual probe: print what a close would end, without ending it
cordis.patch.yml     bundle layer: the one loader row that mounts the plugin
locale/              display name and description for the Plugins page
```

```powershell
node --test "test/*.test.mjs"     # no install step, no dependencies
```

The installed plugin also has a safe mode: set `DSH_EXIT_ON_CLOSE_DRY_RUN=1`
before starting the desktop application and the close button only logs.

## Compatibility

No `@deepseek-ai/dsh*` peer dependency, no service injected or consumed, no tool,
slot, route or service registered, nothing shared patched; `apply` never throws
and never awaits, and `koffi` is imported lazily, so a Host that cannot provide it
logs one line and stays inert instead of affecting another plugin or a profile
boot.

Verified on DeepSeek Harness Desktop `0.2.0-rc.2` (Electron 44, Node 24, Windows
x64).

## License

[MIT](LICENSE)
