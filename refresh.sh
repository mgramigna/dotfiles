#!/bin/sh

echo 'Copying files from home directory'

cp ~/.config/nvim/init.lua ./nvim
cp -r ~/.config/nvim/lua ./nvim
cp ~/.tmux.conf .

echo 'Done'
