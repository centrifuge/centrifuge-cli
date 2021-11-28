import {Command, flags} from '@oclif/command'
import {CliBaseCommand} from "@centrifuge-cli/core/command";
import {IConfig} from "@oclif/config";
import { clearScreenDown } from 'readline';


/**
 * Chain clean up command.
 * 
 * This class implements a command for Centrifuge CLI tool. This chain
 * subcommand allows to remove all artefacts that are created on 'chain'
 * topics, including configurations or caches.
 */
export default class ChainCleanCommand extends CliBaseCommand {
    
    static description = 'clean up currently configured Centrifuge networks';

    static examples = [
        `$ centrifuge chain:clean --all --force`,
        `$ centrifuge chain:clean --config=standalone-centrifuge-chain`,    
    ];

    static flags = {

        // flag for displaying a command-specific help message (-h, --help)
        help: flags.help({char: 'h'}),

        // flag with a value (-c, --config=VALUE)
        config: flags.string({char: 'c', description: 'name of the configuration to clean up'}),
        
        // force cleaning up all network configurations (-a, --all)
        all: flags.boolean({char: 'a'}),

        // force cleaning up all network configurations (-f, --force)
        force: flags.boolean({char: 'f'}),
    };

    static args = [];

    constructor(argv: string[], config: IConfig) {
        super("Clean", argv, config);
    }

    async run() {
        const {args, flags} = this.parse(ChainCleanCommand)

        this.logger.info("First log from tslog")
        this.logger.info("Exiting now...")

        this.exit(2);
    }
}