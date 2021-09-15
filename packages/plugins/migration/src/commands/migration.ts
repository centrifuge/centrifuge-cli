// Here comes the oclif specific stuff
import {flags} from '@oclif/command'
import {ApiPromise, Keyring, SubmittableResult, WsProvider} from "@polkadot/api";
import {Hash} from "@polkadot/types/interfaces";
import * as fs from 'fs';
import {StorageItemElement, PalletElement, StorageElement, StorageItem} from "../migration/common";
import {transform,} from "../migration/transform";
import {ApiTypes, SubmittableExtrinsic} from "@polkadot/api/types";
import {KeyringPair} from "@polkadot/keyring/types";
import {StorageKey} from "@polkadot/types";
import {fork} from "../migration/fork";
import {IConfig} from "@oclif/config";
import {cryptoWaitReady} from "@polkadot/util-crypto"
import {CliBaseCommand} from "@centrifuge-cli/core";
import {Config, Credentials} from "../migration/interfaces";
import {prepareMigrate, migrate, verifyMigration} from "../migration/migrate";


const JSONbig = require('json-bigint')({ useNativeBigInt: true, alwaysParseAsBig: true });

export default class Migration extends CliBaseCommand {
    fromApi!: ApiPromise;
    toApi!: ApiPromise;

    // The keypair that executes the migration
    exec!: KeyringPair

    migrationConfig!: Config

    static description = 'Centrifuge cli command that allows to migrate from a stand-alone to a parachain.'

    static examples = [
        `$ crowdloan --source-network wss://rpc.polkadot.io --destnation-network wss://portal.chain.centrifuge.io ` +
        `--exec SOME_PATH_TO_JSON_OF_ACCOUNT --config SOME_PATH_TO_JSON_CONFIG` ,
    ]

    static args = [
        {
            name: 'source-network',
            required: true,
            description: 'the networks ws-endpoint the state shall be forked from',
        },
        {
            name: 'destination-network',
            required: true,
            description: 'the networks ws-endpoint the state shall be ported to',
        }
    ]

    static flags = {
        'from-block': flags.string({
            char: 'b',
            description: 'specify at which block to take the state from the chain. Input must be a block number.',
            default: '-1',
        }),
        'config': flags.string({
            description: 'Path to a JSON-file that specifies the config for the modules to fetch and in which sequence to migrate this data',
            required: true
        }),
        'creds': flags.string({
            description: 'Path to a JSON-file that specifies the passwords and the path to the executor account.',
            required: true
        }),
        'dry-run': flags.boolean( {
            description: 'This will fetch the storages, do the transformations but then stops before executing the extrinsics.',
        }),
        'verify': flags.boolean({
            description: 'Verifies the migration after running it.',
        }),
    };

    constructor(argv: string[], config: IConfig) {
        super("Crowdloan", argv, config);
    }

    async run() {
        try {
            const {args, flags} = this.parse(Migration)

            // Parse Config
            await this.parseConfig(flags.config);

            // Parse Credentials
            await this.parseCredentials(flags.creds);

            this.logger.debug("Connecting to source network: ", args["source-network"])
            const wsProviderFrom = new WsProvider(args["source-network"]);
            this.fromApi = await ApiPromise.create({
                provider: wsProviderFrom,
                types: {
                    ProxyType: {
                        _enum: ['Any', 'NonTransfer', 'Governance', 'Staking', 'Vesting']
                    }
                }
            });

            this.logger.debug("Connecting to destination network: ", args["destination-network"])
            const wsProviderTo = new WsProvider(args["destination-network"]);
            this.toApi = await ApiPromise.create({
                provider: wsProviderTo,
                types: {
                    ProxyType: {
                        _enum: ['Any', 'NonTransfer', 'Governance', '_Staking', 'NonProxy']
                    }
                }
            });


            // Get latest block from standalone chain
            const startFrom = (await this.fromApi.rpc.chain.getHeader()).hash
            let atFrom = startFrom;

            if (flags["from-block"] != '-1') {
                atFrom = await this.fromApi.rpc.chain.getBlockHash(flags["from-block"]);
                // Check if this really results in a block. This can fail. Hence, we will fail here
                try {
                    await this.fromApi.rpc.chain.getBlock(atFrom);
                } catch (err) {
                    this.logger.fatal("Unable to fetch block " + flags["from-block"] + " from " + args["source-network"] + ". Aborting!");
                    this.exit(2);
                }
            }

            const atTo = (await this.toApi.rpc.chain.getHeader()).hash;

            const storageToFetch = await this.createStorageElements();

            // Fork the data
            const state = await fork(this.fromApi, storageToFetch, atFrom);

            // Transform the data
            const transformedState: Map<string, Map<string, Array<StorageItem>>> = await transform(state, this.fromApi, this.toApi, startFrom, atFrom, atTo);

            // Prepare migration. I.e. generate the extrinsics to be executed
            const migrationExtrinsics = await prepareMigrate(transformedState, this.fromApi, this.toApi);

            // Execute migration
            if (!flags['dry-run']) {
                const sequence = await this.createSequenceElements()
                const failed: Array<SubmittableExtrinsic<ApiTypes, SubmittableResult>> = new Array();
                const executedExts: Array<[Hash, bigint]> = await migrate(this.toApi, this.exec, sequence, migrationExtrinsics, (failedExts) => {
                    failed.push(...failedExts);
                });

                if (failed.length != 0) {
                    let msg = ''
                    let counter = 0;
                    for (const xt of failed) {
                        if (counter !== failed.length) {
                            msg += ("    " + xt.toJSON() + "\n");
                        } else {
                            msg += ("    " + xt.toJSON());
                        }
                        counter++;
                    }

                    this.logger.error("The following extrinsics failed:\n" + msg);
                } else {
                    this.logger.info("Migration was successful.");
                }

                // Log extrinsics
                {
                    let msg = '';
                    let counter = 0
                    for (const xt of executedExts) {
                        if (counter !== failed.length) {
                            msg += ("    Block-hash: " + xt[0].toHex() + " and index: " + xt[1].toString() + "\n");
                        } else {
                            msg += ("    Block-hash: " + xt[0].toHex() + " and index: " + xt[1].toString());
                        }
                        counter++;
                    }
                    this.logger.debug("The following extrinsics were executed:\n" + msg);
                }
            }

            if (flags.verify) {
                this.logger.info("Verifying migration. This will take some time...");

                const newAtTo = (await this.toApi.rpc.chain.getHeader()).hash;
                // Verify
                const inconsistentStorage: Array<[StorageKey, number[] | Uint8Array]>
                    = await verifyMigration(this.toApi, this.fromApi, storageToFetch, atTo, newAtTo, startFrom, atFrom);

                if(inconsistentStorage.length === 0) {
                    this.logger.info("Migration has been verified.");
                } else {
                    let msg = '';
                    let counter = 0;
                    for (const [key, value] of inconsistentStorage) {
                        if (counter != inconsistentStorage.length) {
                            msg += "   Key: " + key + ", value: " + value + "\n";
                        } else {
                            msg += "   Key: " + key + ", value: " + value;
                        }
                    }

                    this.logger.fatal("Failed to verify all migrated storage elements. Failures are (values refer to storage from old-chain): \n" + msg);
                }
            }

            this.fromApi.disconnect();
            this.toApi.disconnect()
        } catch (err) {
            try {
                this.fromApi.disconnect();
                this.toApi.disconnect()
            } catch(err) {
                this.exit(2);
            }
            this.logger.error(err);
            this.exit(2);
        }

    }

    async checkAvailability(elements: Array<StorageElement>): Promise<Array<StorageElement>> {
        // TODO: Check if migration is possible with elements. We currently simply return here
        return elements;
    }

    async createStorageElements(): Promise<Array<StorageElement>> {
        const toBeMigrated = this.migrationConfig.modules;
        let storageElements: Array<StorageElement> = new Array();

        for (const pallet of toBeMigrated){
            if (pallet.item === undefined) {
                storageElements.push(new PalletElement(pallet.name));
            } else {
                storageElements.push(new StorageItemElement(pallet.name, pallet.item.name));
            }
        }

        return this.checkAvailability(storageElements);
    }

    async createSequenceElements(): Promise<Array<StorageElement>> {
        const toBeMigrated = this.migrationConfig.sequence;
        let storageElements: Array<StorageElement> = new Array();

        for (const pallet of toBeMigrated){
            storageElements.push(new StorageItemElement(pallet.name, pallet.item));
        }

        return storageElements;

    }

    async parseConfig(filePath: string) {
        try {
            let file = fs.readFileSync(filePath);
            this.migrationConfig = JSONbig.parse(file.toString());
        } catch (err) {
            return Promise.reject(err);
        }
    }


    private async parseCredentials(filePath: string) {
        try {
            let file = fs.readFileSync(filePath);
            let credentials: Credentials = JSONbig.parse(file.toString());

            if (credentials.rawSeed === undefined) {
                return Promise.reject("Missing seed for executing account.");
            } else {
                const keyring = new Keyring({type: 'sr25519'});
                 if(!await cryptoWaitReady()) {
                     return Promise.reject("Could not initilaize WASM environment for crypto. Aborting!");
                 }
                const execPair = keyring.addFromUri(credentials.rawSeed);
                this.exec = execPair;
            }
        } catch (err) {
            return Promise.reject(err);
        }
    }
}
