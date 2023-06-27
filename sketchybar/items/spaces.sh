SPACE_ICONS=("1" "2" "3" "4" "5")

for i in "${!SPACE_ICONS[@]}"
do
  sid=$(($i+1))
  sketchybar --add space space.$sid left \
             --set space.$sid associated_space=$sid \
                              icon=${SPACE_ICONS[i]} \
                              icon.padding_left=12 \
                              icon.padding_right=12 \
                              icon.highlight_color=0xff50fa7b \
                              label.drawing=off
done

sketchybar --add item space_separator left \
           --set space_separator icon= \
                                 background.padding_left=12 \
                                 background.padding_right=12 \
                                 label.drawing=off \
                                 icon.color=0xffbd93f9
