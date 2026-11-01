# TeamClaude Desktop

Independent community desktop panel for [TeamClaude](https://github.com/KarpelesLab/teamclaude), developed in [Kelll31/teamclaude_desktop](https://github.com/Kelll31/teamclaude_desktop). Windows and Linux, Electron + React, MIT licensed.

The desktop app is maintained here. It is not an official KarpelesLab release.
The TeamClaude proxy remains the backend: the panel uses its control API and CLI
for accounts, routing, quota and proxy lifecycle.

![Desktop walkthrough](docs/assets/desktop-demo.gif)

## Run from source

Requires Node.js 20+ and npm. From this repository:

```bash
cd desktop
npm ci
npm run dev
```

The app uses the backend checkout in `src/` during development. Packaged builds
bundle it and run it with Electron's Node runtime, so end users need no Node.js.
Existing TeamClaude accounts and configuration are reused.

## Features

- Start and stop the local proxy, or attach to an already running one.
- Manage Claude, Codex and API backend accounts through the CLI and control API.
- Monitor quotas, sessions, usage, activity and health.
- Configure routing, editor integrations, tray behaviour and notifications.
- Use English, Russian and seven other interface languages.

[User guide](docs/desktop.md) · [Architecture](docs/desktop-architecture.md) ·
[Development direction](docs/desktop-roadmap.md) · [Backend CLI reference](README-core.md)

## Checks and packages

Run inside `desktop/`:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

End-to-end tests need a desktop display (Xvfb on Linux).
`npm run dist:win` builds an installer and portable executable;
`npm run dist:linux` builds AppImage and deb packages on Linux.
Artifacts go to `desktop/dist/`. The Desktop workflow also builds unsigned
Windows and Linux artifacts for testing; no automatic release publishing is enabled.

Report desktop bugs and feature requests in [this repository's issues](https://github.com/Kelll31/teamclaude_desktop/issues).

## Relationship to upstream

Following the maintainer's direction in [#582](https://github.com/KarpelesLab/teamclaude/issues/582)
and [#618](https://github.com/KarpelesLab/teamclaude/issues/618), the panel is developed
as a community project. This fork is its current home; the backend source and its
MIT attribution remain intact. Desktop development does not depend on an upstream
merge of the panel.

Small backend improvements such as provider-scoped removal and JSON stdin for
`add-backend` can be proposed separately. Backend npm updates still come from
`@karpeleslab/teamclaude`; desktop links and support point here.
