import {Logger as TsLogger} from 'tslog'

export class Logger {
    private static instance: Logger;
    private logger: TsLogger;

    private constructor(logger: TsLogger) {
        this.logger = logger;

    }

    public static getInstance(name: string): TsLogger {
        if (!Logger.instance) {
            Logger.instance = new Logger(new TsLogger());
        }

        return Logger.instance.logger.getChildLogger({name: name});
    }
}

