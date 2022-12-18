CWD = $(shell pwd)
TIMESTAMP = $(shell date +%s)

.PHONY: alacritty nvim tmux

all: nvim tmux alacritty

alacritty: backup-alacritty
	rm -rf ~/.config/alacritty
	ln -s $(CWD)/alacritty ~/.config/alacritty

nvim: backup-nvim
	rm -rf ~/.config/nvim
	ln -s $(CWD)/nvim ~/.config/nvim

tmux: backup-tmux
	rm -rf ~/.config/tmux
	ln -s $(CWD)/tmux ~/.config/tmux

tpm:
	git clone https://github.com/tmux-plugins/tpm ./tmux/plugins/tpm

backup-nvim:
	cp -r ~/.config/nvim ./backups/nvim-backup-$(TIMESTAMP)

backup-tmux:
	cp -r ~/.config/tmux ./backups/tmux-backup-$(TIMESTAMP)

backup-alacritty:
	cp -r ~/.config/alacritty ./backups/alacritty-backup-$(TIMESTAMP)

clean:
	rm -rf backups/*
