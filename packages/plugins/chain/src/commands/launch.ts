import {flags} from '@oclif/command'
import {CliBaseCommand} from "@centrifuge-cli/core";
import {IConfig} from "@oclif/config";

export default class E2E extends CliBaseCommand {
    static description = 'describe the command here'

    static examples = [
        `$ oclif-example hello hello world from ./src/hello.ts!`,
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
        super("E2E", argv, config);
    }

    async run() {
        const {args, flags} = this.parse(E2E)

        const name = flags.name ?? 'world'
        this.log(`hello ${name} from ./src/commands/e2e/e2e.ts`)
        if (args.file && flags.force) {
            this.log(`you input --force and --file: ${args.file}`)
        }

        this.logger.error("Wrond module. idiot.")
    }
}