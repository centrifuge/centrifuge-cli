import { Command as BaseCommand } from '@oclif/command'
import { IConfig } from '@oclif/config'
import { Logger as SingletonLogFacade } from './logger'
import {ILogObject, Logger} from 'tslog'
import * as fs from 'fs';

const packageJson = require('../package.json')

/**
 * Base Centrifuge CLI command.
 *
 * This generic CLI command class provides basic features for each
 * command, such as, for instance, logging and configuration.
 * Ideally, all Centrifuge CLI commands should extend this base
 * command class.
 */
export abstract class CliBaseCommand extends BaseCommand {
    private instance: string
    base = `${packageJson.name}@${packageJson.version}`
    profile: UserProfile;
    logger: Logger;

    dirLog: string;
    dirCommand: string;
    dirBase: string;

    /**
     * Builds a new base command instance.
     *
     * @param arguments List of command-line arguments
     * @param configuration Configuration file
     */
    constructor(instance: string, argv: string[], config: IConfig) {
        super(argv, config);
        this.instance = instance;
        this.profile = this.getProfileOrDefault();
        const [base, log, command] = this.initCfg();
        this.dirCommand = command;
        this.dirLog = log;
        this.dirBase = base;
        this.logger = this.initLogger();

    }

    /**
     * Initalize a logger with defined transports, etc.
     */
    initLogger(): Logger {
        const logger = SingletonLogFacade.getInstance(this.instance);
        logger.setSettings({minLevel: 'info'})

        const logToLogFile = (logObject: ILogObject) => {
            const datetime = new Date();
            const today = datetime.toISOString().slice(0,10);
            const logFile = this.dirLog + '/' +  today + ".log"

            fs.appendFileSync(logFile, JSON.stringify(logObject) + "\n");
        }

        logger.attachTransport({
                silly: logToLogFile,
                debug: logToLogFile,
                trace: logToLogFile,
                info: logToLogFile,
                warn: logToLogFile,
                error: logToLogFile,
                fatal: logToLogFile,
            },
            "silly"
        );

        return logger;
    }

    /**
     * Takes a buffer and an optional name for a folder. If no folder-name is specified then the
     * file will be stored in the command-directory directly. If a filder-name is specified the file will be stored
     * in the folder in the command-directory. If the folder does not yet exist it will be created.
     *
     * @param file
     * @param folder
     */
    writeFile(file: Buffer | string, name: string, folder?: string) {
        if(folder === undefined) {
            fs.writeFileSync(this.dirCommand + '/' + name, file);
        } else {
            const folderPath = this.dirCommand + '/' + folder;
            if (!fs.existsSync(folderPath)) {
                fs.mkdirSync(folderPath)
            }

            fs.writeFileSync(folderPath + '/' + name, file);
        }
    }

    /**
     * Allows to easily read files from the command directory of the cli or the command specific sub-folder of the cli
     *
     */
    readFile(file: string, folder?: string): Buffer {
        if(folder === undefined) {
            const filePath = this.dirCommand + '/' + file;
            return fs.readFileSync(filePath);
        } else {
            const filePath = this.dirCommand + '/' + folder  + '/' + file;
            return fs.readFileSync(filePath);
        }
    }



    /**
     * Initalizes the environment for the CLI.
     *
     * This takes care of checking if a directory is present at "home" and if not it creates it.
     * All subcommands will be able to use this base directory to store command specific profiles.
     * Furthermore, logs will also be stored in this directory.
     */
    initCfg() {
        const cliDir = this.profile.home + '/.cfgCli';

        if (fs.existsSync(cliDir)) {
            return this.initBaseDirectory(cliDir);
        } else {
            CliBaseCommand.createBaseDirectory(cliDir);
            return this.initBaseDirectory(cliDir);
        }
    }

    static createBaseDirectory(path: string) {
        fs.mkdirSync(path);
    }

    initBaseDirectory(baseDir: string): [string, string, string] {
        const dirCommand = baseDir + '/' + this.instance
        if (!fs.existsSync(dirCommand)) {
            fs.mkdirSync(dirCommand)
        }

        const dirLog = baseDir + '/' + "logs"
        if (!fs.existsSync(dirLog)) {
            fs.mkdirSync(dirLog);
        }

        return [baseDir, dirLog, dirCommand];
    }

    getProfileOrDefault(): UserProfile {
        const homedir = require('os').homedir();

        if (fs.existsSync(homedir + '/.cfgProfile')) {
            return CliBaseCommand.parseProfile(homedir + '/.cfgProfile');
        } else {
            return CliBaseCommand.defaultProfile(homedir + '/.cfgProfile');
        }
    }

    static parseProfile(file: string): UserProfile {
        try {
            const profile = fs.readFileSync(file);
            const tProfile: UserProfile = JSON.parse(profile.toString());

            return CliBaseCommand.checkProfile(tProfile);
        } catch (err) {
            throw Error('Error while parsing "UserProfile". Err: \n' + err);
        }
    }

    static defaultProfile(file: string): UserProfile {
        const profile =  {
            home: require('os').homedir()
        };

        fs.writeFileSync(file, JSON.stringify(profile));

        return profile
    }

    static checkProfile(profile: UserProfile): UserProfile {
        // TODO: Currently we do no checks here
        return profile
    }
}

export interface UserProfile {
    home: string
}


