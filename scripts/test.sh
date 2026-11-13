#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
docker run --rm --user "$(id -u):$(id -g)" -e DOTNET_CLI_HOME=/tmp/dotnet -e NUGET_PACKAGES=/source/.nuget -v "$PWD:/source" -w /source mcr.microsoft.com/dotnet/sdk:10.0 dotnet test Dac.slnx --logger 'trx;LogFilePrefix=tests' --results-directory /source/artifacts
