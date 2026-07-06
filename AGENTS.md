# Repository Guidelines

This is a personal dotfiles/bootstrap repository for fresh Ubuntu and macOS machines.

## How it works

- `./bootstrap` is the main entry point for a full setup.
- Subcommands are available for specific steps:
  - `./bootstrap apt` installs Ubuntu packages from `packages/apt`.
  - `./bootstrap brew` installs macOS Homebrew packages from `packages/brew`.
  - `./bootstrap external` installs tools handled outside apt/brew.
  - `./bootstrap link` links dotfiles with GNU Stow.
  - `./bootstrap doctor` prints setup status.
- `make bootstrap`, `make apt`, `make brew`, `make external`, `make link`, and `make doctor` are thin wrappers around the same commands.

## Layout

- `home/` contains cross-platform Stow packages, including zsh, Neovim, tmux, starship, herdr, pi agent config, and local scripts.
- `macos/` contains macOS-only Stow packages, including Ghostty, Karabiner, and cmux config.
- `packages/` contains apt and Homebrew package lists.
- `install/` contains installer scripts for external tools.
- `manual/` contains configs that must be imported manually.

## Pi extensions

When editing pi agent extensions under `home/.pi/agent`, run:

```bash
cd home/.pi/agent && npm run typecheck
```

## Notes for agents

- Avoid committing machine-specific secrets or local paths. Use `~/.zshrc.local` for local overrides.
- Existing target files are backed up under `~/.local/state/dotfiles/backups/` rather than deleted.
- Keep changes simple and portable across Ubuntu and macOS unless a file is clearly platform-specific.
