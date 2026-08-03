#!/usr/bin/env bash
# IQ Academy - Update (delegates to tools/update.sh)
cd "$(dirname "$0")" && exec ./tools/update.sh "$@"
