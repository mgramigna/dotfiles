#!/bin/bash
STATE="$(echo "$INFO" | jq -r '.state')"

if [ "$STATE" = "playing" ]; then
  MEDIA="$(echo "$INFO" | jq -r '.app + ": " + .title + " - " + .artist')"

  if [[ ${#MEDIA} -gt 64 ]]; then
    MEDIA="${MEDIA:0:64}..."
  fi

  sketchybar --set $NAME label="$MEDIA" drawing=on
else
  sketchybar --set $NAME drawing=off
fi
