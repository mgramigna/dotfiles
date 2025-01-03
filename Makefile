CWD = $(shell pwd)
TIMESTAMP = $(shell date +%s)

.PHONY: alacritty nvim tmux scripts starship karabiner ghostty

all: nvim tmux alacritty ghostty scripts starship karabiner

scripts: backup-scripts
	rm -rf ~/.local/scripts
	ln -s $(CWD)/scripts ~/.local/scripts

alacritty: backup-alacritty
	rm -rf ~/.config/alacritty
	ln -s $(CWD)/alacritty ~/.config/alacritty

ghostty: backup-ghostty
	rm -rf ~/.config/ghostty
	ln -s $(CWD)/ghostty ~/.config/ghostty

nvim: backup-nvim
	rm -rf ~/.config/nvim
	ln -s $(CWD)/nvim ~/.config/nvim

starship:
	rm -rf ~/.config/starship
	ln -s $(CWD)/starship ~/.config/starship

tmux: backup-tmux
	rm -rf ~/.config/tmux
	ln -s $(CWD)/tmux ~/.config/tmux

karabiner: backup-karabiner
	rm -rf ~/.config/karabiner
	ln -s $(CWD)/karabiner ~/.config/karabiner

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

backup-ghostty:
	-cp -r ~/.config/ghostty ./backups/ghostty-backup-$(TIMESTAMP)

backup-karabiner:
	-cp -r ~/.config/karabiner ./backups/karabiner-backup-$(TIMESTAMP)

clean:
	-rm -rf backups/*-backup-*
