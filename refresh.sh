#!/bin/sh

echo 'Copying files from home directory'

rm -rf ./nvim
mkdir nvim

cp ~/.config/nvim/init.lua ./nvim
cp -r ~/.config/nvim/lua ./nvim
cp -r ~/.config/nvim/ftdetect ./nvim/
cp -r ~/.config/nvim/syntax ./nvim/
cp ~/.tmux.conf .

echo 'Done'
