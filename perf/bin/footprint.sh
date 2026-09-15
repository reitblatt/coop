#!/usr/bin/env bash
# Emits the on-disk footprint of a Coop checkout as JSON: dependency trees,
# build output, and any built docker images. Everything is in MiB.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

mib() { # path -> MiB, 0 when absent
  if [[ -e "$1" ]]; then du -sm "$1" 2>/dev/null | cut -f1; else echo 0; fi
}

count_pkgs() { # node_modules dir -> number of installed packages
  if [[ -d "$1" ]]; then
    find "$1" -maxdepth 3 -name package.json -not -path "*/node_modules/*/node_modules/*" 2>/dev/null | wc -l
  else
    echo 0
  fi
}

image_mib() { # image ref -> MiB, 0 when not built locally
  local size
  size=$(docker image inspect "$1" --format '{{.Size}}' 2>/dev/null || echo 0)
  echo $(( size / 1024 / 1024 ))
}

cat <<JSON
{
  "rootNodeModulesMib": $(mib node_modules),
  "serverNodeModulesMib": $(mib server/node_modules),
  "clientNodeModulesMib": $(mib client/node_modules),
  "dbNodeModulesMib": $(mib db/node_modules),
  "migratorNodeModulesMib": $(mib migrator/node_modules),
  "nodeModulesTotalMib": $(( $(mib node_modules) + $(mib server/node_modules) + $(mib client/node_modules) + $(mib db/node_modules) + $(mib migrator/node_modules) )),
  "serverTranspiledMib": $(mib server/transpiled),
  "clientBuildMib": $(mib client/build),
  "checkoutMib": $(mib .),
  "serverPackages": $(count_pkgs server/node_modules),
  "clientPackages": $(count_pkgs client/node_modules),
  "rootPackages": $(count_pkgs node_modules),
  "imageServerMib": $(image_mib coop-perf-server),
  "imageServerBaseMib": $(image_mib coop-perf-server-base),
  "imageClientMib": $(image_mib coop-perf-client)
}
JSON
