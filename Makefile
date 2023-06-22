CWD = $(shell pwd)
TIMESTAMP = $(shell date +%s)

.PHONY: alacritty nvim tmux scripts starship yabai skhd sketchybar

all: nvim tmux alacritty scripts starship yabai skhd sketchybar

scripts: backup-scripts
	rm -rf ~/.local/scripts
	ln -s $(CWD)/scripts ~/.local/scripts

alacritty: backup-alacritty
	rm -rf ~/.config/alacritty
	ln -s $(CWD)/alacritty ~/.config/alacritty

nvim: backup-nvim
	rm -rf ~/.config/nvim
	ln -s $(CWD)/nvim ~/.config/nvim

starship:
	rm -rf ~/.config/starship
	ln -s $(CWD)/starship ~/.config/starship

tmux: backup-tmux
	rm -rf ~/.config/tmux
	ln -s $(CWD)/tmux ~/.config/tmux

yabai: backup-yabai
	rm -rf ~/.config/yabai
	ln -s $(CWD)/yabai ~/.config/yabai

skhd: backup-skhd
	rm -rf ~/.config/skhd
	ln -s $(CWD)/skhd ~/.config/skhd

sketchybar: backup-sketchybar
	rm -rf ~/.config/sketchybar
	ln -s $(CWD)/sketchybar ~/.config/sketchybar

tpm:
	git clone https://github.com/tmux-plugins/tpm ./tmux/plugins/tpm

backup-scripts:
	-cp -r ~/.local/scripts ./backups/scripts-backup-$(TIMESTAMP)

backup-nvim:
	-cp -r ~/.config/nvim ./backups/nvim-backup-$(TIMESTAMP)

backup-starship:
	-cp -r ~/.config/starship ./backups/starship-backup-$(TIMESTAMP)

backup-tmux:
	-cp -r ~/.config/tmux ./backups/tmux-backup-$(TIMESTAMP)

backup-alacritty:
	-cp -r ~/.config/alacritty ./backups/alacritty-backup-$(TIMESTAMP)

backup-yabai:
	-cp -r ~/.config/yabai ./backups/yabai-backup-$(TIMESTAMP)

backup-skhd:
	-cp -r ~/.config/skhd ./backups/skhd-backup-$(TIMESTAMP)

backup-sketchybar:
	-cp -r ~/.config/sketchybar ./backups/sketchybar-backup-$(TIMESTAMP)

clean:
	-rm -rf backups/*-backup-*
