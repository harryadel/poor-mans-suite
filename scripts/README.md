# Packaging Scripts

Scripts to create production packages for Poor Man's Suite distribution.

## Usage

### macOS / Linux

```bash
npm run package
```

Or directly:
```bash
node scripts/package.js
```

### Windows (PowerShell)

```powershell
.\scripts\package.ps1
```

## What Gets Excluded

The package script automatically excludes:
- ✅ Test files (`tests/`, `*.test.js`, `*.spec.js`)
- ✅ Dev dependencies (`node_modules/`, `package.json`, `package-lock.json`)
- ✅ Build config (`vitest.config.js`)
- ✅ Git files (`.git/`, `.gitignore`)
- ✅ Internal/development documentation (`Agent.md`, `CONTRIBUTING.md`, `ARCHITECTURE_REVIEW.md`)
- ✅ Build artifacts and existing archives (`dist/`, `build/`, `coverage/`, `temp/`, `*.zip`)

## Output

Creates `poor-mans-suite-extension.zip` in the project root, ready for distribution.

## Build Workflow

```bash
# Run tests first, then package
npm run build

# Or separately:
npm test          # Run tests
npm run package   # Create zip
```
