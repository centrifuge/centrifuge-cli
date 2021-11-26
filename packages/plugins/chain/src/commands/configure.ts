import {Command, flags} from '@oclif/command'
import {CliBaseCommand} from "@centrifuge-cli/core";
import {IConfig} from "@oclif/config";


/**
 * Chain creation command.
 */
export default class ChainConfigureCommand extends CliBaseCommand {
    static description = 'Create a new blockchain ecosystem configuration';
    
    static examples = [
        `$ centrifuge chain:configure`,
    ]

    static flags = {
        help: flags.help({char: 'h'}),
        // flag with a value (-n, --name=VALUE)
        name: flags.string({char: 'n', description: 'name to print'}),
        // flag with no value (-f, --force)
        force: flags.boolean({char: 'f'}),
    }

    static args = [{name: 'file'}]

    constructor(argv: string[], config: IConfig) {
        super("Fork", argv, config);
    }

    async run() {
        const {args, flags} = this.parse(ChainConfigureCommand)

        this.logger.info("First log from tslog")
        this.logger.info("Exiting now...")

        this.exit(2);
    }
}