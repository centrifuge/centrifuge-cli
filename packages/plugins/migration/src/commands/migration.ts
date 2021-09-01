import {Command, flags} from '@oclif/command'
import {CliBaseCommand} from "@centrifuge-cli/core";
import {IConfig} from "@oclif/config";

export default class Migration extends CliBaseCommand {
    static description = 'describe the command here'

    static examples = [
        `$ oclif-example hello
hello world from ./src/hello.ts!
`,
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
        super("Migration", argv, config);
    }

    async run() {
        const {args, flags} = this.parse(Migration)

        this.logger.info("First Migrate log from tslog")
        this.logger.info("Exiting now...")

        this.exit(2);
    }
}