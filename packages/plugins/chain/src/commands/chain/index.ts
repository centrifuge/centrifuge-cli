import { flags } from '@oclif/command'
import { CliBaseCommand } from '@centrifuge-cli/core/command'
import color from '@heroku-cli/color'

export default class ChainCommand extends CliBaseCommand {
  static description = 'list available Centrifuge networks'

  static flags = {
    shell: flags.boolean({ char: 's', description: 'output config vars in shell format' }),
    json: flags.boolean({ char: 'j', description: 'output config vars in json format' }),
  }

  async run() {
    const { args, flags } = this.parse(ChainCommand)

    this.logger.info(`Welcome to ${color.cmd(ChainCommand.id)} command.`)

    this.exit(2)
  }
}
