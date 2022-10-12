#!/bin/sh

echo 'Copying files from home directory'

rm -rf ./nvim
rm -rf ./tmux
mkdir nvim
mkdir tmux

cp ~/.config/nvim/init.lua ./nvim
cp -r ~/.config/nvim/lua ./nvim
cp -r ~/.config/nvim/ftdetect ./nvim/
cp -r ~/.config/nvim/after ./nvim/after
cp -r ~/.config/tmux/tmux.conf ./tmux

echo 'Done'
