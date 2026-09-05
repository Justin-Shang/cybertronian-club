#!/usr/bin/env bash
set -e
cd /home/ubuntu/cybertronian-club
set -a; . ./.env; set +a
exec node --enable-source-maps artifacts/api-server/dist/index.mjs
