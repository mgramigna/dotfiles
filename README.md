## Link files

To link all dotfiles:

```bash
make
```

This will also create backups of existing directory in `./backups`. To clean up (remove) backups in the `./backups` folder, run `make clean`.

To link an individual dotfile:

```bash
make nvim # or
make alacritty # or
make tmux # or
make scripts
```

## Neovim first time setup

Recommended dependencies (not required):

- Install [ripgrep](https://github.com/BurntSushi/ripgrep) (improves Telescope and vimgrep experience)
- Install [prettier](https://prettier.io/) (allows for formatter to work globally):

```bash
npm install -g prettier
```

## Tmux first time setup

### Install tpm

```bash
make tpm
```

### Install reattach-to-user-namespace For System Clipboard (macOS only)

```bash
brew install reattach-to-user-namespace
```
