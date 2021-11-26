centrifuge-cli
==============

Centrifuge-cli tool. Allows to interact with different components of the Centrifuge infrastructure and provides different tools as plugins.

[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Version](https://img.shields.io/npm/v/centrifuge-cli.svg)](https://npmjs.org/package/centrifuge-cli)
[![Downloads/week](https://img.shields.io/npm/dw/centrifuge-cli.svg)](https://npmjs.org/package/centrifuge-cli)
[![License](https://img.shields.io/npm/l/centrifuge-cli.svg)](https://github.com/centrifuge/centrifuge-cli/blob/master/package.json)

<!-- toc -->
* [Usage](#usage)
* [Commands](#commands)
<!-- tocstop -->
# Usage
<!-- usage -->
```sh-session
$ npm install -g centrifuge-cli
$ centrifuge COMMAND
running command...
$ centrifuge (-v|--version|version)
centrifuge-cli/0.0.1 darwin-x64 node-v14.16.1
$ centrifuge --help [COMMAND]
USAGE
  $ centrifuge COMMAND
...
```
<!-- usagestop -->
# Commands
<!-- commands -->
* [`centrifuge hello [FILE]`](#centrifuge-hello-file)
* [`centrifuge help [COMMAND]`](#centrifuge-help-command)

## `centrifuge hello [FILE]`

describe the command here

```
USAGE
  $ centrifuge hello [FILE]

OPTIONS
  -f, --force
  -h, --help       show CLI help
  -n, --name=name  name to print

EXAMPLE
  $ centrifuge hello
  hello world from ./src/hello.ts!
```

_See code: [src/commands/hello.ts](https://github.com/centrifuge/centrifuge-cli/blob/v0.0.1/src/commands/hello.ts)_

## `centrifuge help [COMMAND]`

display help for centrifuge

```
USAGE
  $ centrifuge help [COMMAND]

ARGUMENTS
  COMMAND  command to show help for

OPTIONS
  --all  see all commands in CLI
```

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/v3.2.3/src/commands/help.ts)_
<!-- commandsstop -->
