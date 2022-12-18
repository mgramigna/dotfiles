## Link files

To link all dotfiles:

```
make
```

This will also create backups of existing directory in `./backups`

To link an individual dotfile:

```
make nvim # or
make alacritty # or
make tmux
```

## Neovim first time setup

Recommended dependencies (not required):

- Install [ripgrep](https://github.com/BurntSushi/ripgrep) (improves Telescope and vimgrep experience)
- Install [prettier](https://prettier.io/) (allows for formatter to work globally):

```
npm install -g prettier
```

## Tmux first time setup

### Install tpm

```
make tpm
```

### Install reattach-to-user-namespace For System Clipboard (macOS only)

```
brew install reattach-to-user-namespace
```
