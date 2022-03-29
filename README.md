# Welcome to Centrifuge CLI
This CLI is build with `OCliff` and consists of core part that enables logging, and loading of user profiles
and of different plugins.

## Setup
These are optional but highly recommended steps

* Install [nvm](https://github.com/nvm-sh/nvm)
* Run `nvm use`

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
Once the project has been built, you can choose to run it like so:

```bash
node packages/cli/bin/run <subcommand>
```
