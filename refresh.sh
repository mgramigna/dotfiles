#!/bin/sh

echo 'Copying files from home directory'

cp ~/.config/nvim/init.vim ./nvim
cp ~/.config/nvim/plugins/plugins.vim ./nvim/plugins
cp -r ~/.config/nvim/after ./nvim/after
cp ~/.tmux.conf .

echo 'Done'
