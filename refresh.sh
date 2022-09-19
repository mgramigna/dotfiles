#!/bin/sh

echo 'Copying files from home directory'

rm -rf ./nvim
mkdir nvim

cp ~/.config/nvim/init.lua ./nvim
cp -r ~/.config/nvim/lua ./nvim
cp -r ~/.config/nvim/ftdetect ./nvim/
cp -r ~/.config/nvim/after ./nvim/after
cp ~/.tmux.conf .

echo 'Done'
