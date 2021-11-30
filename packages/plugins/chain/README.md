# Centrifuge Chain Management Commands Plugin

## Introduction

This [`centrifuge-cli`]() plugin provides essential commands for managing a local or remote Centrifuge Chain ecosystem, running on a local host or on a cloud-based platform (using Kubernetes, for instance). For instance, a blockchain ecosystem made up of Polkadot relay chain, on which one or more parachains are registered, can easily be boostraped from a terminal, for development or testing purpose.

## Available Commands

| Command | Description |
| --- | :--- |
| `chain:setup` | Configure basic settings, such as cloud provider, user preferences and more. This command is usually executed only once, when setting up your host or cloud environment. |
| `chain:configure` | Create or modify a blockchain ecosystem configuration. |
| `chain:create` | Create a new local or cloud-based blockchain ecosystem. |
| `chain:start` | Start an existing blockchain ecosystem configuration. The configuration must be first built using `chain:configure` command. |
| `chain:stop` | Stop a currently running blockchain ecosystem. |

## Credits

This plugin leverages on [`polkadot-launch`](https://github.com/paritytech/polkadot-launch) tool, implemented by Parity Tech.
