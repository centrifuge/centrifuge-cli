# Welcome to Centrifuge CLI

This **Centrifuge CLI** allows you to manage from a terminal, various Centrifuge resources, such as, for instance, a complete Centrifuge network (or blockchain) or Centrifuge decentralized applications.

## Introduction
In **Centrifuge CLI**, each command is implemented as an [oclif plugin](https://oclif.io/docs/plugins), that is then bundled and published as a [NPM package](https://www.npmjs.com/) on the NPM package manager's hub. Plugins can be installed on-demand, using the `centrifuge plugin:install` command, as explained later in this document.

Commands are grouped into *topics*, the latter being considered as categories containing a set of sub-commands. If you are not familiar with *topics* and *commands* concepts, please refer to the [Topics and Commands](#topics_and_commands) paragraph, later in this document.

## Installing Centrifuge CLI

## Command Topics

Currently, the following topics are provided by the **Centrifuge CLI**:

| Topics name | Description |
| :---: | :--- |
| [chain](./packages/plugins/chain) | Local or remote (cloud-based) Centrifuge network management. This command can b|

You can list all available topics and commands using the following command:

```sh
$ centrifuge-cli commands
```
## Project Structure

```sh
`packages`
|-- `cli`           - entry point plugin
|-- `libraries`     - common Typescript/Javascript libraries
|-- `plugins`       - commands (and topics) plugins
```
## Extending Centrifuge CLI

For contributing to the **Centrifuge CLI**, you should first clone the repository on your host machine using the following command, if you use HTTPS access to Github:

```sh
$ git clone https://github.com/centrifuge/centrifuge-cli.git
```

or like as follows if you prefer to use SSH connection:

```sh
$ git@github.com:centrifuge/centrifuge-cli.git
```

Now switch to the `centrifuge-cli` local repository and run a seminal setup:

```sh
$ cd centrifuge-cli
$ yarn
```

For running the **Centrifuge CLI** from your local repository, you execute the following command from your local repository's root directory:

```sh
$ cd centrifuge-cli
$ ./packages/cli/bin/run [topics:command] [arguments] [options]
```

Being a multi-packages Typescript project, **Centrifuge CLI** packages and libraries are managed using [`lerna`](https://lerna.js.org/). The lerna commands are transparently executed using [`yarn`](https://yarnpkg.com/) scripts (see the `scripts` section of [package.json](./package.json) file for more information).

The following [`yarn`](https://yarnpkg.com/) scripts are currently available for managing the complete life-cycle of **Centrifuge CLI** projet and its components:

| Command | Description |
| :---: | :--- |
| `yarn clean` | Remove all generated components, including Javascript files, test coverage, and so on. The `lerna run clean --concurrency 4` commmand is actually executed. |
| `yarn build` | Compile all packages, using `lerna run build --concurrency 4` commmand behind the scene. |
| `yarn test` | Run unit tests on all packages, using `lerna run test --concurrency 4` commmand behind the scene. |
| `yarn pack` | Build NPM packages, ready to be published to [NPM hub](https://www.npmjs.com/) using `yarn publish` command. `lerna run pack --concurrency 4` is executed. |
| `yarn publish` | Publish NPM packages to [NPM hub](https://www.npmjs.com/) using `yarn publish` command. `lerna run publish` is executed in the background. |

## Topics and Commands

The naming for commands follows the convention `topics:command` pattern. For instance, in the pattern `chain:create`, the `chain` is the target and `create` the command (also called *action*). The [topics](https://oclif.io/docs/topics) is usually a noun and the command a verb, so that the pattern can be read as "apply the requested *command* on the given *topic*". In other words, a command is an action performed on a topic (we prefer the term *target*, however). Topic and command names should ideally be a single lowercase word, without hypens, spaces, underscores or other delimiters. Note, however, that colons (i.e. ':') are allowed as this is how subcommands are created in [oclif](https://oclif.io/docs/topics).

A CLI plugin should export only one topics (containing one or more sub-commands) or should extend (i.e. adding a new command to) an existing topics.

## Using Flags and Arguments

Generally, flags are preferred over arguments, when [creating a new command](#developing_plugins), as flags better convey the intention of commands and make them easier to read and understand. Moreover, flags allows to provide more explicit error messages and better autocompletion support. 
## Running Centrifuge CLI

During development phase, the Centrifuge CLI can be executed as follows, from the repository's root folder:

```sh
$ ./bin/run [topics:command] [options]
```

such as, for instance:

```sh
$ ./bin/run chain:setup --config local_config.json
```

which is used for initializing the Centrifuge blockchain's playground.
