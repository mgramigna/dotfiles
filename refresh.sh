#!/bin/sh

echo 'Copying files from home directory'

cp ~/.config/nvim/init.vim .
cp ~/.tmux.conf .
cp ~/.config/nvim/coc-settings.json .

echo 'Done'
