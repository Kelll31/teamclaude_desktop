> **Unofficial build.** TeamClaude Desktop {{VERSION}} is built and published by the
> [Kelll31/teamclaude_desktop](https://github.com/Kelll31/teamclaude_desktop) fork. It is **not** a
> TeamClaude release and is not supported by the TeamClaude maintainers
> ([KarpelesLab/teamclaude](https://github.com/KarpelesLab/teamclaude)). The builds are
> **not code-signed**: Windows SmartScreen warns before the first install
> (More info → Run anyway). Check the SHA-256 sums below.

A desktop control panel for a local TeamClaude proxy. It bundles the backend, so
Node.js is not needed. Accounts, routing and the config stay in TeamClaude; the
app does not persist account credentials. User-entered API keys are passed to the backend for saving and may be used for an explicit connection test.

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

### What's new in 0.3.3

- **Test connection now lists models** using an OpenAI-compatible
  `GET /v1/models` request with Bearer authorization. It never runs a model.
  Only the API address and key are needed for the check.
- Pick a returned model and add it to the service form. Model mappings can
  still be entered manually for Claude Code.
- API addresses with or without a trailing `/v1` are accepted without
  duplicating `/v1` when a service is saved.
- Bearer is the default for new services; the authentication selector controls
  subsequent Claude requests. Listing models does not verify Claude Messages support.
- Includes the 0.3.2 fix for separately removing Claude and Codex accounts
  with the same email address.
- Updated translations and GIF walkthrough.

Windows installer and Linux AppImage copies support automatic updates.
Portable Windows and Debian packages are updated by downloading/installing the new file.
