import { Command, flags } from '@oclif/command'
import { CliBaseCommand } from '@centrifuge-cli/core/command'
import { IConfig } from '@oclif/config'

/**
 * Start Centrifuge network command.
 */
export default class ChainStartCommand extends CliBaseCommand {
  static description = 'start a Centrifuge network, given a configuration'

  static examples = [`$ centrifuge chain:start --config basic-template.json`]

  // Command flags definition */
  static flags = {
    // flag for displaying command-specific sub-commands help message (-h, --help)
    help: flags.help({ char: 'h' }),

    // flag for giving configuration file path (-c, --config=[filepath])
    config: flags.string({ char: 'c', description: 'configuration file pathname' }),

    // flag with no value (-f, --force)
    force: flags.boolean({ char: 'f' }),
  }

  // Command arguments
  static args = [
    // name of the network configuration to start
    { name: 'configuration' },
  ]

  /**
   * Build a new instance of chain start command.
   */
  constructor(argv: string[], config: IConfig) {
    super('Start', argv, config)
  }

  /**
   * Execute chain starting command.
   */
  async run() {
    this.log()
    const { args, flags } = this.parse(ChainStartCommand)

    this.logger.info('First log from tslog')
    this.logger.info('Exiting now...')

    this.exit(2)
  }
}
