# Poor Man's Suite Development Workflow

## Maintained Checkout and Branches

- `/home/harry/Projects/poor-mans-suite` is the canonical maintained checkout and Chromium-loaded extension path.
- `develop` is the active integration branch for ongoing Poor Man's Suite development.
- `main` is the publication branch and must represent the latest released extension. Do not commit routine development directly to `main`.
- `origin` points to `https://github.com/harryadel/poor-mans-suite` for maintained-project work.
- Create maintained-project feature branches from `develop` and target `harryadel/poor-mans-suite:develop` with pull requests.
- `/home/harry/Projects/rep-chrome` hosts the frozen `local-live` branch and the shared Git metadata for existing upstream PR worktrees. Do not use `local-live` for new Poor Man's Suite development or remove that checkout while those worktrees remain.

Keep the maintained checkout current with a fast-forward update:

```bash
git -C /home/harry/Projects/poor-mans-suite switch develop
git -C /home/harry/Projects/poor-mans-suite pull --ff-only origin develop
```

## Updating the Loaded Extension

Chromium reads the unpacked extension directly from `/home/harry/Projects/poor-mans-suite`; a GitHub push does not reload it.

1. Open `chrome://extensions`.
2. Click **Reload** on **Poor Man's Suite**.
3. Close and reopen DevTools so the Poor Man's Suite panel reloads.

Do not load feature or upstream PR worktrees in Chromium. Keeping the loaded path fixed prevents branch switches and unfinished work from changing the daily extension unexpectedly.

## Upstream Remote and Still-Open PR Worktrees

- Retain the `upstream` remote for `https://github.com/repplus/rep-chrome`.
- Upstream contributions remain separate from Poor Man's Suite maintenance and must use dedicated worktrees based directly on `upstream/main`.
- Keep each current upstream PR branch and worktree until its PR is merged or explicitly closed:

| PR | Worktree | Branch |
| --- | --- | --- |
| #87 | `/home/harry/Projects/rep-chrome-pr-opencode-provider` | `feat/opencode-provider` |
| #88 | `/home/harry/Projects/rep-chrome-pr-bulk-replay-permission-preflight` | `feat/bulk-replay-permission-preflight` |
| #89 | `/home/harry/Projects/rep-chrome-pr-ai-chat-actions` | `feat/ai-chat-actions` |
| #90 | `/home/harry/Projects/rep-chrome-pr-bulk-response-markers` | `feat/bulk-response-markers` |
| #91 | `/home/harry/Projects/rep-chrome-pr-bulk-replay-config` | `fix/bulk-replay-config-persistence` |

- Do not merge Poor Man's Suite `develop`, `main`, or the frozen `local-live` branch into an upstream PR branch.

To start separate upstream work:

```bash
git -C /home/harry/Projects/poor-mans-suite fetch upstream
git -C /home/harry/Projects/poor-mans-suite worktree add ../rep-chrome-pr-<slug> -b feat/<slug> upstream/main
```

Perform implementation, tests, commits, pushes, and PR updates for upstream changes in the dedicated PR worktree. Before creating or updating an upstream PR, verify the complete diff against upstream:

```bash
git status --short --branch
git log --oneline upstream/main..HEAD
git diff --check upstream/main...HEAD
git diff --stat upstream/main...HEAD
```

Push the feature branch to the fork and target `repplus/rep-chrome:main`. Do not delete its branch or worktree while the upstream PR remains open.

## Identity and Licensing

- Use **Poor Man's Suite** for the product name and `poor-mans-suite` for machine-facing slugs and package names.
- Keep `LICENSE` as GPL-3.0-or-later and preserve `NOTICE` plus every file under `LICENSES/` in source and production packages.
- Keep rep+ and `repplus/rep-chrome` references only where upstream attribution or upstream contribution workflow requires them.
- Do not reintroduce legacy runtime identifiers or storage keys. This fork intentionally uses a fresh extension identity without migration from rep+ settings.

## Syncing Selected Upstream Changes

Fetch from `upstream` in the maintained checkout, review the incoming changes, and merge or cherry-pick them into a maintained-project feature branch created from `develop`. Do not assume all upstream branding or repository metadata should be copied into Poor Man's Suite.

## Publishing a Release

1. Ensure `develop` is clean, current, and fully tested.
2. Update release metadata on `develop`, including matching versions in `manifest.json`, `package.json`, and `package-lock.json`.
3. Merge `develop` into `main` through a reviewed release pull request.
4. Switch the maintained checkout to `main`, pull with `--ff-only`, and run `npm run build`.
5. Publish `poor-mans-suite-extension.zip` and create the corresponding GitHub release or tag from `main`.
6. Switch the maintained checkout back to `develop` before starting new work.

## Finishing Work

- Run relevant targeted tests before publishing a maintained or upstream PR.
- Run `npm test` before merging maintained-project changes into `develop`.
- Run `npm run package` only when a production archive is required. Release archives must be built from `main`.
- Review staged files and ensure unrelated local changes are not committed.
- Remove obsolete PR worktrees only after their branches are merged or explicitly confirmed as no longer needed.
