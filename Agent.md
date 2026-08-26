# Poor Man's Suite Development Workflow

## Maintained Checkout and Branch

- `/home/harry/Projects/poor-mans-suite` is the intended Chromium-loaded checkout after the rebrand transition.
- `main` is the maintained branch for Poor Man's Suite.
- `origin` should point to `https://github.com/harryadel/poor-mans-suite` for maintained-project work.
- Create feature branches from the maintained `main` branch and target `harryadel/poor-mans-suite:main` with maintained-project pull requests.
- `/home/harry/Projects/rep-chrome` and its `local-live` branch are transition-era resources, not the permanent loaded-checkout workflow. Do not delete that branch or checkout as part of the transition; retire them only after the new checkout is explicitly verified.

Keep the maintained checkout current with a fast-forward update:

```bash
git -C /home/harry/Projects/poor-mans-suite switch main
git -C /home/harry/Projects/poor-mans-suite pull --ff-only origin main
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
- The still-open upstream PR #87 uses `/home/harry/Projects/rep-chrome-pr-opencode-provider` on `feat/opencode-provider`. Keep that worktree and branch while the PR remains open.
- Do not merge Poor Man's Suite `main` or the transition-era `local-live` branch into an upstream PR branch.

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

Push the feature branch to the fork and target `repplus/rep-chrome:main`. Do not delete existing branches or worktrees during the Poor Man's Suite transition.

## Syncing Selected Upstream Changes

Fetch from `upstream` in the maintained checkout, review the incoming changes, and merge or cherry-pick them into a maintained-project feature branch. Do not assume all upstream branding or repository metadata should be copied into Poor Man's Suite.

## Finishing Work

- Run relevant targeted tests before publishing a maintained or upstream PR.
- Run `npm run package` only when a production archive is required; its output is `poor-mans-suite-extension.zip`.
- Review staged files and ensure unrelated local changes are not committed.
- Remove obsolete PR worktrees only after their branches are merged or explicitly confirmed as no longer needed.
