# Welcome to Centrifuge CLI

This **Centrifuge CLI** allows you to manage a Centrifuge resources, including the blockchain layer and decentralized applications, from a terminal or command-line console.

## Contributing

For contributing to the **Centrifuge CLI**, you should first clone the repository on your host machine using the following command, if you use HTTPS access to Github:

```sh
$ git clone https://github.com/centrifuge/centrifuge-cli.git
```

or like this if using SSH, instead:

```sh
$ git@github.com:centrifuge/centrifuge-cli.git
```

Now change to `centrifuge-cli` local repository and run a seminal setup:

```sh
$ cd centrifuge-cli
$ yarn
```

For running the **Centrifuge CLI** from your local repository, you should execute the following command from your local repository's root directory, as shown below:

```sh
$ cd centrifuge-cli
$ ./packages/cli/bin/run [target:command] [arguments | options]
```

Being a multi-packages Typescript project, `centrifuge-cli` is managed using [`lerna`](https://lerna.js.org/). The lerna commands are transparently executed using [`yarn`](https://yarnpkg.com/)scripts (see the script section in the [package.json](./package.json) file).

The following commands are provide for managing the complete life-cycle of the projet:

| Command | Description |
| :---: | :--- |
| `yarn clean` | Remove all generated components, including Javascript files, test coverage, and so on. The `lerna run clean --concurrency 4` commmand is actually executed. |
| `yarn build` | Compile all packages, using `lerna run build --concurrency 4` commmand behind the scene. |
| `yarn test` | Run unit tests on all packages, using `lerna run test --concurrency 4` commmand behind the scene. |
| `yarn pack` | Build NPM packages, ready to be published to [NPM hub](https://www.npmjs.com/) using `yarn publish` command. `lerna run pack --concurrency 4` is executed. |
| `yarn publish` | Publish NPM packages to [NPM hub](https://www.npmjs.com/) using `yarn publish` command. `lerna run publish` is executed in the background. |

## Command Naming Convention

Commands are implemented as [oclif plugins](https://oclif.io/docs/plugins), that are then published as [NPM packages](https://www.npmjs.com/).

The naming for commands follows the convention `target:command` pattern. For instance, in the pattern `chain:create`, the `chain` is the target and `create` the command (also called *action*). The target is usually a noun and the command a verb, so that the pattern can be read as "apply the *command* on the *target*". In other words, a command is an action performed on a target. Target and command names should ideally be a single lowercase word, without hypens, spaces, underscores or other exotic separators.

A CLI plugin should export only one target (containing one or more commands) or should extend (i.e. adding a new command to) an existing target.

## Command Flags and Arguments

## Developing New Commands

During development phase, the Centrifuge CLI can be executed using the `run` script, as follows:

```sh
$ ./packages/cli/bin/run [target:command] [options]
```

such as, for instance:

```sh
$ ./packages/cli/bin/run chain:setup --config local_config.json
```

which is used for initializing the Centrifuge blockchain's playground.
