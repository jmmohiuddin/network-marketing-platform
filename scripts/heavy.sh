#!/bin/sh
# Runs a heavy command (test suite, typecheck) when one of 2 machine-wide slots is free.
# 16 GB laptop already deep in swap: more than 2 heavy commands at once thrashes it.
DIR="$(dirname "$0")/../var"
mkdir -p "$DIR"
while :; do
  for n in 1 2; do
    if mkdir "$DIR/heavy-$n.lock" 2>/dev/null; then
      trap 'rmdir "$DIR/heavy-$n.lock"' EXIT INT TERM
      "$@"
      exit $?
    fi
  done
  sleep 5
done
