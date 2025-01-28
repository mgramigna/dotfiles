## Link files

To link all dotfiles:

```bash
make
```

This will also create backups of existing directory in `./backups`. To clean up (remove) backups in the `./backups` folder, run `make clean`.

To link an individual dotfile directory, e.g. neovim only:

```bash
make nvim
```

## Neovim first time setup

Recommended dependencies (not required):

- Install [ripgrep](https://github.com/BurntSushi/ripgrep?tab=readme-ov-file#installation) (improves Telescope and vimgrep experience)

## Tmux first time setup

### Install tpm

```bash
make tpm
```
