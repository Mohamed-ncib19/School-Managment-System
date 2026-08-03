#!/usr/bin/env bash
# IQ Academy - Stop (delegates to tools/stop.sh)
cd "$(dirname "$0")" && exec ./tools/stop.sh "$@"
