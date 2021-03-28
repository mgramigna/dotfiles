#!/bin/sh

echo 'Copying files from repo into directories'

mv ~/.config/nvim/init.vim ~/.config/nvim/init.vim.bak
mv ~/.tmux.conf ~/.tmux.conf.bak
mv ~/.config/nvim/coc-settings.json ~/.config/nvim/coc-settings.json.bak

cp ./init.vim ~/.config/nvim
cp ./.tmux.conf ~
cp ./coc-settings.json ~/.config/nvim/coc-settings.json

echo 'Done'
