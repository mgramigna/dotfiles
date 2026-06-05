## Bootstrap

This repository is optimized for bootstrapping fresh Ubuntu and macOS machines.

```bash
./bootstrap
```

On Ubuntu, the default bootstrap command installs apt packages, installs a small set of external tools, links dotfiles with GNU Stow, and prints a setup summary.

On macOS, start with Homebrew packages:

```bash
./bootstrap brew
```

Existing files are not deleted. If a target already exists and is not the expected symlink, it is moved to:

```
~/.local/state/dotfiles/backups/
```

## Commands

```bash
./bootstrap          # full setup
./bootstrap apt      # install Ubuntu packages
./bootstrap brew     # install macOS Homebrew packages
./bootstrap external # install external tools
./bootstrap link     # link dotfiles only
./bootstrap doctor   # print setup status
```

The Makefile provides the same commands as thin wrappers:

```bash
make bootstrap
make apt
make brew
make external
make link
make doctor
```

## Packages

Ubuntu packages are listed in `packages/apt`.

macOS Homebrew packages are listed in `packages/brew` using `brew bundle` format.

`lazygit` is installed through apt on Ubuntu 25.10 and newer, where it is available from the default repositories. Neovim and Tree-sitter CLI are installed outside apt because Ubuntu versions can lag behind editor integration requirements.

Fast-moving tools or tools with installer-specific behavior are handled in `install/external`, including:

- oh-my-zsh
- zsh-syntax-highlighting
- zsh-autosuggestions
- starship
- rustup
- tree-sitter-cli
- n
- atuin
- bob
- tailscale

## Linked Dotfiles

Dotfiles are organized as top-level Stow packages:

```text
home/.zshrc
home/.config/nvim
home/.config/opencode
home/.config/tmux
home/.config/starship
home/.local/scripts
```

macOS-only app configs are organized in the `macos` Stow package:

```text
macos/.config/ghostty
macos/.config/karabiner
macos/.config/cmux
```

The default Ubuntu setup links:

- `~/.zshrc`
- `~/.config/nvim`
- `~/.config/opencode`
- `~/.config/tmux`
- `~/.config/starship`
- `~/.local/scripts`

On macOS, `./bootstrap link` also links Ghostty, Karabiner, and cmux configs.

Rectangle does not use a simple config path for Stow. The exported Rectangle config is version-controlled at `manual/rectangle/RectangleConfig.json` and can be imported manually from Rectangle.

## Local Shell Overrides

The version-controlled zsh config sources `~/.zshrc.local` when it exists. Put machine-specific paths, secrets, work config, and local tool initialization there instead of committing them to this repository.

Use `home/.zshrc.local.example` as a starting point for a new machine.
