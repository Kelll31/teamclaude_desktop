# Desktop development direction

TeamClaude Desktop is maintained independently in
[Kelll31/teamclaude_desktop](https://github.com/Kelll31/teamclaude_desktop). This replaces the
historical upstream panel proposal and split PR plan in `desktop-pr-plan/`.

## Current layout

- `desktop/`: Electron app, renderer, services, tests and packaging.
- `src/`, `test/`, root `package.json`: the backend checkout and its tests.
  The upstream npm identity is preserved for backend version reporting and updates.
- `docs/desktop*.md`: desktop user and developer documentation.
- `README-core.md`: the original backend README.

The fork is the current home of the desktop. It still contains the backend;
extracting the panel into a desktop-only repository is a separate migration.
The app accesses backend state through the control API and invokes its CLI;
it does not import backend implementation modules into the renderer.

## Next steps

1. Keep Windows and Linux builds, tests and desktop releases under this project's
   control. The Desktop workflow builds unsigned artifacts; app update feeds
   remain unconfigured until a desktop release process is ready.
2. Send the small backend changes (`remove --provider` and stdin `add-backend`)
   upstream as separate PRs, with independent CLI tests. They are already in
   this fork's bundled backend. Their acceptance is not assumed.
3. Verify these commands against newer upstream cores before relying on them;
   a minimum version check alone does not establish support for every command.
4. Separate desktop packaging from a sibling backend checkout so the panel can
   be extracted without carrying backend development or release workflows.
5. Once the project home and user documentation are published, request the
   community link the maintainer offered in upstream #582 and #618.

## Contribution boundaries

Desktop features and bug reports go to this repository. Backend fixes stay
small and independently reviewable. Upstream's npm and container publishing
workflows are restricted to `KarpelesLab/teamclaude`; they do not publish from
this fork. Desktop support links point here; backend release notes and npm
core updates continue to point to upstream.

Do not replace the backend package name with the desktop name: the bundled
backend and downloaded upstream cores use that metadata at runtime.
