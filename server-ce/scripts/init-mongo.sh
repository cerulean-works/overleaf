#!/bin/bash
set -euo pipefail

for attempt in {1..60}; do
  if mongosh --host mongo:27017 --quiet --eval 'quit(db.adminCommand({ ping: 1 }).ok ? 0 : 1)' >/dev/null 2>&1; then
    exec mongosh --host mongo:27017 --quiet --file /scripts/init-mongo.js
  fi
  sleep 1
done

echo "MongoDB did not become reachable within 60 seconds." >&2
exit 1
