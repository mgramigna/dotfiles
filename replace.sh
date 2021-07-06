#!/bin/sh

echo 'Copying files from repo into directories'
timestamp=$(date +%s)

mv ~/.config/nvim/ ~/.config/nvim-$timestamp.bak
mv ~/.tmux.conf ~/.tmux.conf-$timestamp.bak

cp -r nvim ~/.config/
cp ./.tmux.conf ~

echo 'Done'
