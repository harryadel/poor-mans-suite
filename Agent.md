# Local Development Workflow

## Checkout Roles

- `/home/harry/Projects/rep-chrome` is the Chromium-loaded checkout.
- This checkout must stay on the private `local-live` branch.
- `local-live` is the integration branch for code Harry actively uses. Push it only to `origin`; never open an upstream PR from it.
- Upstream PRs must use dedicated worktrees and branches based directly on `upstream/main`.
- PR #87 uses `/home/harry/Projects/rep-chrome-pr-opencode-provider` on `feat/opencode-provider`.

## Starting Upstream Work

From the Chromium-loaded checkout:

```bash
git fetch upstream
git worktree add ../rep-chrome-pr-<slug> -b feat/<slug> upstream/main
```

Perform all implementation, tests, commits, pushes, and PR updates for that change in its PR worktree. Do not branch from `local-live`, because it can contain multiple pending or personal changes.

Before creating a PR, verify the complete diff against upstream:

```bash
git status --short --branch
git log --oneline upstream/main..HEAD
git diff --check upstream/main...HEAD
git diff --stat upstream/main...HEAD
```

Push the feature branch to the fork and create the PR against `repplus/rep-chrome:main`.

## Updating the Local Extension

Only committed and verified feature work should be integrated into `local-live`:

```bash
git -C /home/harry/Projects/rep-chrome switch local-live
git -C /home/harry/Projects/rep-chrome merge --no-ff feat/<slug>
git -C /home/harry/Projects/rep-chrome push origin local-live
```

Chromium reads the unpacked extension directly from `/home/harry/Projects/rep-chrome`; a GitHub push does not reload it. After changing `local-live`:

1. Open `chrome://extensions`.
2. Click **Reload** on rep+.
3. Close and reopen DevTools so the rep+ panel reloads.

Do not load a PR worktree in Chromium. Keeping the loaded path fixed prevents branch switches and unfinished PR work from changing the daily extension unexpectedly.

## Syncing Upstream

Keep the local integration branch current without rebasing it:

```bash
git -C /home/harry/Projects/rep-chrome fetch upstream
git -C /home/harry/Projects/rep-chrome switch local-live
git -C /home/harry/Projects/rep-chrome merge upstream/main
git -C /home/harry/Projects/rep-chrome push origin local-live
```

When upstream changes during PR development, update the feature branch inside its own worktree. Never merge `local-live` into an upstream PR branch.

## Finishing Work

- Run relevant targeted tests and the production package command before integrating into `local-live` or publishing a PR.
- Review staged files and ensure unrelated local changes are not committed.
- Remove obsolete PR worktrees only after their branches are merged or no longer needed:

```bash
git worktree remove ../rep-chrome-pr-<slug>
```
