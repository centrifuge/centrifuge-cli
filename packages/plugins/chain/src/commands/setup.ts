import {Command, flags} from '@oclif/command'
import {CliBaseCommand} from "@centrifuge-cli/core";
import {IConfig} from "@oclif/config";


/**
 * Chain setup command.
 * 
 * This class implements a command for Centrifuge CLI tool. The latter 
 * is usually when you start working with local or remote (cloud-based)
 * ecosystems, during developmemt, testing or benchmarking phases, or 
 * for partners or community to be able to easily launch a testing chain.
 * A setup wizzard is proposed if no arguments are passed to the command.
 */
export default class ChainSetupCommand extends CliBaseCommand {
    static description = 'setup blockchain management tool';

    static examples = [
        `$ centrifuge chain:setup`,
    ]

    static flags = {
        help: flags.help({char: 'h'}),
        // flag with a value (-n, --name=VALUE)
        name: flags.string({char: 'n', description: 'name to print'}),
        // flag with no value (-f, --force)
        force: flags.boolean({char: 'f'}),
    }

    static args = [
        {name: 'k8s-namespace'}
    ]

    constructor(argv: string[], config: IConfig) {
        super("Fork", argv, config);
    }

    async run() {
        const {args, flags} = this.parse(ChainSetupCommand)

        this.logger.info("First log from tslog")
        this.logger.info("Exiting now...")

        this.exit(2);
    }
}