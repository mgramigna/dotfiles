#!/bin/sh

echo 'Copying files from repo into directories'
timestamp=$(date +%s)

mv ~/.config/nvim/ ~/.config/nvim-$timestamp.bak
mv ~/.config/tmux/ ~/.config/tmux/tmux-$timestamp.bak

cp -r nvim ~/.config/
cp -r tmux ~/.config/

echo 'Done'
