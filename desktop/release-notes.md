> **Unofficial build.** TeamClaude Desktop {{VERSION}} is built and published by the
> [Kelll31/teamclaude](https://github.com/Kelll31/teamclaude) fork. It is **not** a
> TeamClaude release and is not supported by the TeamClaude maintainers
> ([KarpelesLab/teamclaude](https://github.com/KarpelesLab/teamclaude)). The builds are
> **not code-signed**: Windows SmartScreen warns before the first install
> (More info → Run anyway). Check the SHA-256 sums below.

A desktop control panel for a local TeamClaude proxy. It bundles the backend, so
Node.js is not needed. Accounts, routing and the config stay in TeamClaude; the
app holds no credentials.

| File | For |
| --- | --- |
| `TeamClaude-Desktop-Setup-{{VERSION}}.exe` | Windows 10/11 x64, installer — **updates itself** |
| `TeamClaude-Desktop-Portable-{{VERSION}}.exe` | Windows, no install — update by downloading again |
| `TeamClaude-Desktop-{{VERSION}}-x86_64.AppImage` | Linux x64 — **updates itself** |
| `TeamClaude-Desktop-{{VERSION}}-amd64.deb` | Debian/Ubuntu x64 — update by installing the new package |

Self-updating copies check this repository's releases a minute after launch
and every 6 hours, download in the background and install when the app quits
(Settings → Updates). `latest.yml` and `latest-linux.yml` are the update
feed.

### What's new in 0.3

- **Proxy core updates from npm.** The bundled TeamClaude is kept current with
  upstream's npm releases: npm registry signature and sha512 checked, test-run,
  switched, with rollback if the new core does not start (Settings → Updates).
- **Connect an editor in one click**: Claude Code (all editors and the CLI),
  VS Code, Insiders, Cursor, Windsurf, VSCodium, Zed; JetBrains IDEs follow
  Claude Code. "Open a folder…" starts an editor with the proxy set.
- **Usage** page: tokens, cache hit rate and requests per account, CSV export.
- **Health** page: proxy response time, restarts, per-account errors and switches.
- **Run-out forecast**: when an account will hit its limit before the reset,
  on Accounts and Overview, with a notification an hour ahead.
- **Routing profiles**: save threshold + distribution under a name, apply from
  the Routing page or the tray.
- **Quota widget**: a small always-on-top window with every account's quota.
- **Global shortcut** to switch to the next account (off by default).
- **Encrypted backup** of the TeamClaude config and quota state, to move to
  another computer (Settings → Backup and transfer).
- **9 languages**: English, Русский, Українська, Deutsch, Français, Español,
  Português (Brasil), 简体中文, 日本語.
- Bundles TeamClaude 1.1.26.
