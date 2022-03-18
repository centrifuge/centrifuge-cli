# Welcome to Centrifuge CLI
This CLI is build with `OCliff` and consists of core part that enables logging, and loading of user profiles
and of different plugins.

## Build
All of the following commands must be run in the root directory of the repository.

* Install the dependencies:

```shell=
yarn install
```

* Build artifacts (this needs to be run everytime some code changes):

```shell=
lerna run build
```

## Run
```shell=
./packages/cli/bin/run.js [COMMAND]
```

Example:
```shell=
./packages/cli/bin/run.js migration ws://127.0.0.1:9998 ws://127.0.0.1:9994 --config ./packages/plugins/migration/config/test-migration-config.json --creds ./packages/plugins/migration/config/alice-creds.json --verify
```
