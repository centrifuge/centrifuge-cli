import { Command as BaseCommand } from '@oclif/command'
import { IConfig } from '@oclif/config'
import { Logger as SingletonLogFacade } from './logger'
import { Logger } from 'tslog'

const packageJson = require('../package.json')

/**
 * Base command for CLI command.
 *
 * This generic CLI command class provides basic features to each
 * command, such as, for instance, logging and configuration.
 */
export abstract class CliBaseCommand extends BaseCommand {
    private instance: string
    base = `${packageJson.name}@${packageJson.version}`

    // TODO: Might be private and only gettable via log().info() but this seems to be the wrong syntax
    logger: Logger

    /**
     * Builds a new base command instance.
     *
     * @param arguments List of command-line arguments
     * @param configuration Configuration file
     */
    constructor(instance: string, argv: string[], config: IConfig) {
        super(argv, config)
        this.instance = instance;
        this.logger = SingletonLogFacade.getInstance(instance);
    }

}
