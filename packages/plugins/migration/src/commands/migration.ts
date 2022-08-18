// Here comes the oclif specific stuff
import {flags} from '@oclif/command'
import {ApiPromise, Keyring, SubmittableResult, WsProvider} from "@polkadot/api";
import {Hash} from "@polkadot/types/interfaces";
import * as fs from 'fs';
import {StorageItem} from "../migration/common";
import {transform,} from "../migration/transform";
import {ApiTypes, SubmittableExtrinsic} from "@polkadot/api/types";
import {KeyringPair} from "@polkadot/keyring/types";
import {StorageKey} from "@polkadot/types";
import {fork} from "../migration/fork";
import {IConfig} from "@oclif/config";
import {cryptoWaitReady} from "@polkadot/util-crypto"
import {CliBaseCommand} from "@centrifuge-cli/core";
import {buildExtrinsics, migrate, verifyMigration} from "../migration/migrate";
import {
    Credentials,
    Migrations,
    MigrationSummary,
    toStorageElement
} from "../migration/interfaces";

const avnTypes = require('avn-types');
const JSONbig = require('json-bigint')({ useNativeBigInt: true, alwaysParseAsBig: true });

export default class Migration extends CliBaseCommand {
    fromApi!: ApiPromise;
    toApi!: ApiPromise;

    // The keypair that executes the migration
    keyPair!: KeyringPair

    migrations!: Migrations

    static description = 'Centrifuge cli command that allows to migrate from a stand-alone to a parachain.'

    static examples = [
        `$ crowdloan --source-network wss://rpc.polkadot.io --destnation-network wss://portal.chain.centrifuge.io ` +
        `--keyPair SOME_PATH_TO_JSON_OF_ACCOUNT --config SOME_PATH_TO_JSON_CONFIG` ,
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
            exclusive: ['dry-run']
        }),
        'just-verify': flags.string({
            description: 'Just verifies a given migration. Must provide a path to a JSON containing a MigrationSummary object',
            exclusive: ['verify', 'dry-run']
        })
    };

    constructor(argv: string[], config: IConfig) {
        super("Migration", argv, config);
    }

    async run() {
        try {
            const {args, flags} = this.parse(Migration)

            // Parse Config
            await this.parseConfig(flags.config);

            // Parse Credentials
            await this.parseCredentials(flags.creds);

            this.logger.info("Connecting to source chain: ", args["source-network"])
            const wsProviderFrom = new WsProvider(args["source-network"]);
            this.fromApi = await ApiPromise.create({
                provider: wsProviderFrom,
                typesBundle: avnTypes,
            });

            this.logger.info("Connecting to destination network: ", args["destination-network"])
            const wsProviderTo = new WsProvider(args["destination-network"]);
            this.toApi = await ApiPromise.create({
                provider: wsProviderTo,
                types: {
                    ProxyType: {
                        _enum: ['Any', 'NonTransfer', 'Governance', '_Staking', 'NonProxy']
                    }
                }
            });

            // Get the latest block from the source chain
            const startFrom = (await this.fromApi.rpc.chain.getHeader()).hash
            this.logger.info("Starting migration from stand-alone chain block with hash " + startFrom);
            let atFrom = startFrom;

            if (flags["from-block"] != '-1') {
                atFrom = await this.fromApi.rpc.chain.getBlockHash(flags["from-block"]);
                this.logger.info("Fetching storage from stand-alone chain block with hash " + atFrom);
                // Ensure that this block actually exists in the source chain
                try {
                    await this.fromApi.rpc.chain.getBlock(atFrom);
                } catch (err) {
                    this.logger.fatal("Unable to fetch block " + flags["from-block"] + " from " + args["source-network"] + ". Aborting!");
                    this.exit(2);
                }
            }

            const atTo = (await this.toApi.rpc.chain.getHeader()).hash;
            this.logger.info("Starting migration from parachain block with hash "  + atTo);
            // This will be used later for the summary
            let endTo: Hash;
            // The source and destination storage elements.
            const storageToFetch = this.migrations.map(m => toStorageElement(m.source));

            if (flags['just-verify'] === undefined) {
                // A copy of the source storage state we are interested in
                const sourceState = await fork(this.fromApi, storageToFetch, atFrom);
                // Transform the source state to match the appropriate schema in the destination
                const transformedState: Map<string, Map<string, Array<StorageItem>>>
                    = await transform(sourceState, this.fromApi, this.toApi, startFrom, atFrom, atTo);
                const extrinsics = await buildExtrinsics(transformedState, this.fromApi, this.toApi);

                // Execute migration
                if (!flags['dry-run']) {
                    const failed: Array<SubmittableExtrinsic<ApiTypes, SubmittableResult>> = [];
                    const destinationStorageElements
                        = this.migrations.map(m => toStorageElement(m.destination));

                    const executedExtrinsics: Array<[Hash, bigint]>
                        = await migrate(
                            extrinsics,
                            destinationStorageElements,
                            this.toApi, this.keyPair,
                        (failedExts) => { failed.push(...failedExts)}
                        );

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

                        console.error("❌ The following extrinsics failed:\n" + msg);
                    } else {
                        this.logger.info("✅ Migration was successful.");
                    }

                    // Log extrinsics
                    {
                        let msg = '';
                        let counter = 0
                        for (const xt of executedExtrinsics) {
                            if (counter !== failed.length) {
                                msg += ("    Block-hash: " + xt[0].toHex() + " and index: " + xt[1].toString() + "\n");
                            } else {
                                msg += ("    Block-hash: " + xt[0].toHex() + " and index: " + xt[1].toString());
                            }
                            counter++;
                        }
                        this.logger.debug("The following extrinsics were executed:\n" + msg);
                    }

                    endTo = (await this.toApi.rpc.chain.getHeader()).hash;
                    this.logger.info("Ending migration on destination chain at block hash" + endTo);
                    await this.writeSummary(this.migrations, startFrom, atFrom, atTo, endTo);
                }
            }

            if (flags.verify || flags['just-verify']) {
                this.logger.info("⌛ Verifying migration. This will take some time...");

                let startFromHash: Hash;
                let atFromHash: Hash;
                let atToHash: Hash;
                let endToHash: Hash;

                if(flags['just-verify'] === undefined) {
                    startFromHash = startFrom;
                    atFromHash = atFrom;
                    atToHash = atTo;
                    // @ts-ignore // This is fine as flags ensure this.
                    endToHash = endTo;
                } else {
                    const summary: MigrationSummary = await this.parseSummary(flags['just-verify']);

                    startFromHash = await this.fromApi.rpc.chain.getBlockHash(summary.fromStartedAt);
                    atFromHash = await this.fromApi.rpc.chain.getBlockHash(summary.fromFetchedAt);
                    atToHash = await this.toApi.rpc.chain.getBlockHash(summary.toStartedAt);
                    endToHash = await this.toApi.rpc.chain.getBlockHash(summary.toEndAt);

                    // Check if we can actually get a block
                    await this.fromApi.rpc.chain.getBlock(startFromHash);
                    // Check if we can actually get a block
                    await this.fromApi.rpc.chain.getBlock(atFromHash);
                    // Check if we can actually get a block
                    await this.toApi.rpc.chain.getBlock(atToHash);
                    // Check if we can actually get a block
                    await this.toApi.rpc.chain.getBlock(endToHash);
                }

                // Verify the migration
                const inconsistentStorage: Array<[StorageKey, number[] | Uint8Array]>
                    = await verifyMigration(
                        this.migrations,
                    {
                                api: this.fromApi,
                                startBlock: startFromHash,
                                endBlock: atFromHash,
                            },
                    {
                        api: this.toApi,
                        startBlock: atToHash,
                        endBlock: endToHash,
                    },
                );

                if (inconsistentStorage.length === 0) {
                    this.logger.info("✅️ Migration has been verified successfully");
                } else {
                    this.logger.info("❌ Migration failed for the following " + inconsistentStorage.length + "storage elements (source storage values):");
                    let errMsg = inconsistentStorage.reduce((errMsg, [key, value]) => {
                        errMsg += "  Key: " + key + ", value: " + value + "\n";
                        return errMsg;
                    }, "");

                    console.error("\n" + errMsg);
                }
            }

            await this.fromApi.disconnect();
            await this.toApi.disconnect();

            this.logger.info("👋 Done, bye now.");
        } catch (err) {
            this.logger.error(err);

            try {
                await this.fromApi.disconnect();
                await this.toApi.disconnect()
            } catch(err) {
                this.exit(2);
            }
            this.exit(2);
        }
    }

    // Write the migration summary to disk
    async writeSummary(migrations: Migrations, startBlockFrom: Hash, stateTakenBlockFrom: Hash, startBlockTo: Hash, endBlockTo: Hash) {
        let summary: MigrationSummary = {
            fromStartedAt: (await this.fromApi.rpc.chain.getBlock(startBlockFrom)).block.header.number.toBigInt(),
            fromFetchedAt: (await this.fromApi.rpc.chain.getBlock(stateTakenBlockFrom)).block.header.number.toBigInt(),
            toStartedAt: (await this.toApi.rpc.chain.getBlock(startBlockTo)).block.header.number.toBigInt(),
            toEndAt: (await this.toApi.rpc.chain.getBlock(endBlockTo)).block.header.number.toBigInt(),
        }

        const subDir = "Summaries";
        const filename = "migration-" + Date.now() + ".json";
        const json = JSONbig.stringify(summary, null, 2);
        this.logger.info("The following migration summary will be written to disk now: \n   "  + json);

        try {
            this.writeFile(json, filename, subDir);
            this.logger.info("✔️ Summary written to ", this.dirCommand + "/" + subDir + "/" + filename);
        } catch (err) {
            this.logger.info("❌ Failed to write the migration summary to disk:", err);
        }
    }

    async parseSummary(filePath: string): Promise<MigrationSummary> {
        try {
            let file = fs.readFileSync(filePath);
            const summary: MigrationSummary = JSONbig.parse(file.toString());

             if (summary.toEndAt === undefined) {
                 return Promise.reject("Missing 'toEndAt' in MigrationSummary")
             }

            if (summary.fromFetchedAt === undefined) {
                return Promise.reject("Missing 'fromFetchedAt' in MigrationSummary")
            }

            if (summary.fromStartedAt === undefined) {
                return Promise.reject("Missing 'fromStartedAt' in MigrationSummary")

            }
            if (summary.toStartedAt === undefined) {
                return Promise.reject("Missing 'toStartedAt' in MigrationSummary")

            }

            return summary;
        } catch (err) {
            return Promise.reject(err);
        }
    }

    async parseConfig(filePath: string) {
        try {
            let file = fs.readFileSync(filePath);
            this.migrations = JSONbig.parse(file.toString());
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
                this.keyPair = keyring.addFromUri(credentials.rawSeed);
            }
        } catch (err) {
            return Promise.reject(err);
        }
    }
}
