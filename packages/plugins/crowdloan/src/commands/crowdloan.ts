import {Command, flags} from '@oclif/command'
import {IConfig} from "@oclif/config";
import {ApiPromise, WsProvider, Keyring} from "@polkadot/api";
import {AccountId, Balance, EventRecord, Hash} from "@polkadot/types/interfaces";
import {KeyringPair} from "@polkadot/keyring/types";
import {GenericExtrinsic} from "@polkadot/types";
import {compactAddLength} from "@polkadot/util";
import { blake2AsHex } from "@polkadot/util-crypto";
import {DownloadResponse, Storage} from "@google-cloud/storage";
import * as fs from "fs";
import {cryptoWaitReady} from "@polkadot/util-crypto"
import {getContributions as getContributionsKusama} from "../crowdloan/kusama";
import {getContributions as getContributionsPolkadot} from "../crowdloan/polkadot";

const JSONbig = require('json-bigint')({ useNativeBigInt: true, alwaysParseAsBig: true });

import {fetchChildState, createDefaultChildStorageKey, Hasher} from "@centrifuge-cli/sp-state-fetch";
import {hexEncode, LeU32Bytes, toUtf8ByteArray, fromUtf8ByteArray, hexDecode} from "@centrifuge-cli/util"
import {CliBaseCommand} from "@centrifuge-cli/core";

import {Config, CrowdloanSpec, TransformConfig, MerkleTree, Credentials, Proof} from "../crowdloan/interfaces";
import {RegistryTypes} from "@polkadot/types/types";


export default class Crowdloan extends CliBaseCommand {
    // Configuration parsed from JSON
    crwdloanCfg!: Config

    // The api providing access to the parachain
    paraApi!: ApiPromise

    // This one will only be filled during generation of Keypairs if simulate is set
    syntheticAccounts: Map<AccountId, [KeyringPair, bigint]> = new Map()

    // The account that will initialize the pallets and also fund the reward pallet (sudo account)
    executor!: KeyringPair

    gcloudPrivateKey!: string
    gcloudClientEmail!: string

    static description = 'Centrifuge cli command that allows to fetch crowdloan contributions from a relay chain and initialize ' +
        'the crowdloan modules on the parachain'

    static examples = [
        `$ crowdloan --relay wss://rpc.polkadot.io --para wss://portal.chain.centrifuge.io ` +
            `--exec SOME_PATH_TO_JSON_OF_ACCOUNT --config SOME_PATH_TO_JSON_CONFIG` ,
    ]

    static flags = {
        'relay': flags.string({
            char: 'r',
            description: 'the network name of the relay-chain',
            options: ['Kusama', 'Polkadot'],
            required: true
        }),
        'para': flags.string({
            char: 'p',
            description: 'the networks ws-endpoint of the para chain',
            // TODO: remove and add required after testing
            default: 'ws://localhost:9946'
        }),
        'config': flags.string({
            description: 'Path to a JSON-file that specifies the config for the crowdloan-modules and crowdloan data from relay-chain',
            required: true
        }),
        'creds': flags.string({
            description: 'Path to a JSON-file that specifies the passwords for the cloud-storage.',
            required: true
        }),
        'dry-run': flags.boolean({
            description: 'If present, the cli will generate the tree and spill out the amount of funding needed for the exec.',
            default: false,
        }),
        'tree-output': flags.string({
            description: 'If present, the cli will generate a JSON file containing the generated merkle tree. The argument is the path were tree is stored.',
            default: './packages/cli/outputs'
        }),
        // TODO: Implement this feature
        'run-from-tree': flags.string({
            description: 'Allows to initialize the pallets with a tree previsouly created with this script',
            exclusive: ['simulate, dry-run, tree-output']
        }),
        'simulate':  flags.boolean({
            description: 'if present, the data from the contributions will be simulated and not fetched from a relay chain',
        }),
        'test': flags.boolean({
            description: 'if present, a randomly sized set of the contributions will run reward-calls against the chain. Generated accounts will be funded from exec.',
            dependsOn: ['simulate'],
            exclusive: ['dry-run'],
        }),
    };

    constructor(argv: string[], config: IConfig) {
        super("Crowdloan", argv, config);
    }

    async run() {
        try {
            const {args, flags} = this.parse(Crowdloan)

            this.paraApi = await Crowdloan.getApiPromise(flags.para, {
                RootHashOf: 'Hash',
                TrieIndex: 'u32',
            });

            this.crwdloanCfg = await Crowdloan.parseConfig(flags.relay, flags.config);

            this.logger.debug(this.crwdloanCfg)

            await this.parseCredentials(flags.creds);

            let contributions: Map<AccountId, Balance>;
            if (flags['run-from-tree'] === undefined) {
                 contributions = (flags.simulate)
                    ? await this.generateContributions()
                    : await this.getContributions(flags.relay);

                if (flags.simulate) {
                    let file = './packages/cli/outputs/CROWDLOAN-syntheticContributors-' + Date.now() + '.json'
                    let asArray = new Array();
                    this.syntheticAccounts.forEach(([keyPair, amount], id) => asArray.push({
                        account: id.toHex(),
                        keyPair: keyPair.toJson(),
                        contribution: amount
                    }));

                    if (fs.existsSync('./packages/cli/outputs')) {
                        fs.writeFile(file, JSONbig.stringify(asArray, null, '\t'), err => {
                            if (err) {
                                this.logger.error("Error writing synthetic contributors to file. \n" + err)
                                this.logger.debug("Synthetic Contributors: \n" + JSONbig.stringify(asArray, null, '\t'));
                            }
                        });

                    } else {
                        this.logger.warn("Folder '" + process.cwd() + "/outputs' does not exist. Could not store Merkle-tree.")
                        this.logger.debug("Synthetic Contributors: \n" + JSONbig.stringify(asArray, null, '\t'));
                    }
                }
            }

            const tree: MerkleTree = (flags['run-from-tree'] === undefined)
                // @ts-ignore // We assign "contribution" above, when have flag NOT set
                ? await Crowdloan.generateMerkleTree(contributions)
                : await Crowdloan.parseMerkleTree(flags['run-from-tree'])

            if(flags["tree-output"] !== undefined) {
                if(fs.existsSync(flags["tree-output"])) {
                    fs.writeFile(flags["tree-output"] + "/CROWDLOAN-merkleTree-" + Date.now() + ".json", JSONbig.stringify(tree, null, '\t'), err => {
                        if(err) {
                            this.logger.error("Error writing Merkle-tree to file. \n" + err);
                            this.logger.debug("Merkle Tree: \n" + JSONbig.stringify(tree, null, '\t'));
                        }
                    });
                } else {
                    this.logger.warn("Folder " + flags["tree-output"] + " does not exist. Could not store Merkle-tree.")
                    this.logger.debug("Merkle Tree: \n" + JSONbig.stringify(tree, null, '\t'));
                }
            }

            const funding: Balance = await this.calculateFunding(tree);

            const { data: execBalance } = await this.paraApi.query.system.account(this.crwdloanCfg.fundingAccount);

            if (!flags["dry-run"]) {
                if (!(funding.toBigInt() <= execBalance.free.toBigInt())) {
                    const additional = this.paraApi.createType("Balance", funding.toBigInt() - execBalance.free.toBigInt());
                    throw new Error("Exec has " + execBalance.free.toHuman() + ". This is an insufficient balance. Needs " + additional.toHuman() + " more.")
                }

                await this.initializePallets(tree, funding.toBigInt());

                if(flags.test && flags.simulate) {
                    await this.runTest(tree);
                }
            } else {
                this.logger.info("The RewardPallet needs a funding of at least " + funding.toHuman());

                if (funding.toBigInt() <= execBalance.free.toBigInt()) {
                    this.logger.info("Exec has sufficient balance with " + execBalance.free.toHuman());
                } else {
                    const additional = this.paraApi.createType("Balance", funding.toBigInt() - execBalance.free.toBigInt());
                    this.logger.warn("Exec has " + execBalance.free.toHuman() + ". This is an insufficient balance. Needs " + additional.toHuman() + " more.");
                }
            }

            this.paraApi.disconnect();
        } catch (err) {
            this.logger.error(err);
            // We need to manually disconnect here.
            try {
                this.paraApi.disconnect();
            } catch (err) {
                this.logger.error(err)
            }
        }

    }

    private async parseCredentials(filePath: string) {
        try {
            let file = fs.readFileSync(filePath);
            let credentials: Credentials = JSONbig.parse(file.toString());

            if (credentials.executorURI === undefined) {
                return Promise.reject("Missing URI for executor account");
            }

            this.executor = await this.parseAccountFromURI(credentials.executorURI);

            if (credentials.gcloudPrivateKey === undefined) {
                return Promise.reject("Missing priavte key for gcloud");
            } else {
                this.gcloudPrivateKey = credentials.gcloudPrivateKey;
            }
            if (credentials.gcloudClientEmail === undefined) {
                return Promise.reject("Missing gcloud client email.");
            } else {
                this.gcloudClientEmail = credentials.gcloudClientEmail;
            }


        } catch (err) {
            return Promise.reject(err);
        }
    }

    private async calculateFunding(contributions: MerkleTree): Promise<Balance> {
        let funding = BigInt(0);

        for (const {contribution} of contributions.data) {
            funding += contribution;
        }

        // We increase by one as we want the PalletId to be kept alive on-chain
        return this.paraApi.createType("Balance", funding + BigInt(1));
    }

    private async parseAccountFromURI(uri: string): Promise<KeyringPair> {
        const keyring = new Keyring({type: 'sr25519'});

        if(!await cryptoWaitReady()) {
            return Promise.reject("Could not initilaize WASM environment for crypto. Aborting!");
        }

        try {
            let executor = keyring.addFromUri(uri);
            return executor;
        } catch (err) {
            return Promise.reject(err);
        }
    }

    private static async getApiPromise(provider: string, options?: RegistryTypes): Promise<ApiPromise> {
        try {
            const wsProvider = new WsProvider(provider);
            return  await ApiPromise.create({
                provider: wsProvider,
                types: options
            });
        } catch (err) {
            return Promise.reject(err)
        }
    }

    private static async parseConfig(network: string, file: string): Promise<Config> {
        try {
            const raw = fs.readFileSync(file);
            const config: Config = JSONbig.parse(raw.toString("utf-8"));
            await Crowdloan.checkConfig(network, config);
            return config;
        } catch (err) {
            return Promise.reject(err);
        }
    }

    private static async checkConfig(network: string, config: Config): Promise<void> {
        // Check Config
        if (config.fundingAccount === undefined) {
            return Promise.reject("Missing `FundingAccount`")
        }
        if (config.crowdloans === undefined || config.crowdloans.length === 0) {
            return Promise.reject("Missing `Crowdloans`")
        }
        if (config.claimPallet === undefined) {
            return Promise.reject("Missing `ClaimPallet`")
        }
        if (config.rewardPallet === undefined) {
            return Promise.reject("Missing `RewardPallet`")
        }
        if (config.transformation === undefined) {
            return Promise.reject("Missing `Transformation`")
        }

        // Check crowdloans
        for (const crowdloan of config.crowdloans) {
            if (crowdloan.network === undefined) {
                return Promise.reject("Missing `Crowdloan.network`")
            }
            if (crowdloan.paraId === undefined) {
                return Promise.reject("Missing `Crowdloan.paraId`")
            }
            if (crowdloan.trieIndex === undefined) {
                return Promise.reject("Missing `Crowdloan.trieIndex`")
            }
            if (crowdloan.endBlock === undefined) {
                return Promise.reject("Missing `Crowdloan.endBlock`")
            }
            if (crowdloan.createBlock === undefined) {
                return Promise.reject("Missing `Crowdloan.createBlock`")
            }
        }

        // Check inner claimPallet
        if (config.claimPallet.index === undefined) {
            return Promise.reject("Missing `ClaimPallet.index`")
        }
        if (config.claimPallet.leasePeriod === undefined) {
            return Promise.reject("Missing `ClaimPallet.leasePeriod`")
        }
        if (config.claimPallet.leaseStart === undefined) {
            return Promise.reject("Missing `ClaimPallet.leaseStart`")
        }
        if (config.claimPallet.locketAt === undefined) {
            return Promise.reject("Missing `ClaimPallet.locketAt`")
        }

        // Check inner rewardPallet
        if (config.rewardPallet.directPayoutRatio === undefined) {
            return Promise.reject("Missing `RewardPallet.directPayoutRatio`")
        }
        if (config.rewardPallet.vestingPeriod === undefined) {
            return Promise.reject("Missing `RewardPallet.vestingPeriod`")
        }
        if (config.rewardPallet.vestingStart === undefined) {
            return Promise.reject("Missing `RewardPallet.vestingStart`")
        }

        // Check transformation
        if(network === 'Kusama') {
            if (config.transformation.kusama === undefined){
                return Promise.reject('Missing Kusama transformation config');
            }
            if (config.transformation.kusama.decimalDifference === undefined) {
                return Promise.reject("Missing `transformation.decimalDifference`")
            }
            if (config.transformation.kusama.conversionRate === undefined) {
                return Promise.reject("Missing `transformation.conversionRate`")
            }
            if (config.transformation.kusama.earlyBirdPrct === undefined) {
                return Promise.reject("Missing `transformation.earlyBirdPrct`")
            }
            if (config.transformation.kusama.earlyBirdBlock === undefined) {
                return Promise.reject("Missing `transformation.earlyBirdBlock`")
            }
            if (config.transformation.kusama.prevCrwdLoanPrct === undefined) {
                return Promise.reject("Missing `transformation.prevCrwdLoanPrct`")
            }
            if (config.transformation.kusama.referedPrct === undefined) {
                return Promise.reject("Missing `transformation.referedPrct`")
            }
        } else if (network === 'Polkadot') {
            if (config.transformation.polkadot === undefined){
                return Promise.reject('Missing Polkadot transformation config');
            }
            // TODO: Additional checks here.
        } else {
            return Promise.reject("Unknown network. Aborting!");
        }
    }

    private async initializePallets(tree: MerkleTree, funding: bigint): Promise<void> {
        const palletAddressString = await hexEncode("modl")
            + (await this.paraApi.consts.crowdloanReward.palletId).toHex().slice(2);
        const maybeFull32Bytes = Array.from(await hexDecode(palletAddressString));
        while (maybeFull32Bytes.length <= 32) {
            maybeFull32Bytes.push(0);
        }
        let rewardPalletAddr = this.paraApi.createType("AccountId", compactAddLength(Uint8Array.from(maybeFull32Bytes)));

        let finalized = false;

        let startBlock = (await this.paraApi.rpc.chain.getHeader()).number.toBigInt();

        //@ts-ignore
        const rootHash = this.paraApi.createType("RootHashOf", tree.rootHash);
        const fundingAccount = this.paraApi.createType("AccountId", this.crwdloanCfg.fundingAccount);

        // Three extrinsics
        // 1. init pallet claim
        // 2. init pallet reward
        // 3. fund pallet reward
        const { nonce: nonceT } = await this.paraApi.query.system.account(this.executor.address);
        const nonce = nonceT.toBigInt();

        try {
            let unsubClaimInit = await this.paraApi.tx.sudo.sudo(
                this.paraApi.tx.utility.batchAll([
                    this.paraApi.tx.crowdloanClaim.initialize(
                        rootHash,
                        this.crwdloanCfg.claimPallet.locketAt,
                        this.crwdloanCfg.claimPallet.index,
                        this.crwdloanCfg.claimPallet.leaseStart,
                        this.crwdloanCfg.claimPallet.leasePeriod
                    ),
                    this.paraApi.tx.crowdloanReward.initialize(
                        this.crwdloanCfg.rewardPallet.directPayoutRatio,
                        this.crwdloanCfg.rewardPallet.vestingPeriod,
                        this.crwdloanCfg.rewardPallet.vestingStart,
                    ),
                    this.paraApi.tx.balances.forceTransfer(
                        fundingAccount,
                        rewardPalletAddr,
                        funding
                    )
                ])
            ).signAndSend(this.executor, {nonce: nonce}, (result) => {
                if (result.status.isFinalized) {
                    finalized = true;
                    unsubClaimInit();
                }
            });
        } catch (err) {
            this.logger.error("Error: \n" + err);
        }

        let currentBlock = (await this.paraApi.rpc.chain.getHeader()).number.toBigInt();
        // We wait either till it is finalized or for 2 minutes -> 20*6s
        while (!finalized || currentBlock <= startBlock + BigInt(2)) {
            await new Promise(r => setTimeout(r, 3000));
            currentBlock = (await this.paraApi.rpc.chain.getHeader()).number.toBigInt();
        }

        if(!finalized) {
            return Promise.reject("Pallets could not be initialized and funded. Aborting!")
        }
    }

    private async runTest(tree: MerkleTree): Promise<void> {
        // TODO:
        this.logger.warn("Currently NO tests against pallets provided...");
    }



    private async getContributions(network: string): Promise<Map<AccountId, Balance>> {
        if (network === 'Kusama') {
            const api = await Crowdloan.getApiPromise("wss://kusama-rpc.polkadot.io");
            const codes =  await this.fetchCodesFromCloud(
                api,
                'centrifuge-production-x',
                'altair_referral_codes'
            );

            api.disconnect().then().catch(err => this.logger.warn(err));

            return getContributionsKusama(
                this.paraApi,
                this.crwdloanCfg.crowdloans,
                this.crwdloanCfg.transformation.kusama,
                codes,
                this.logger.getChildLogger({name: "Crowdloan - Kusama"})
            );
        } else if (network === 'Polkadot') {
            // TODO: Not yet implenented
            // return getContributionsPolkadot();
            return Promise.reject('Polkadot not yet implemented. Aborting!');
        } else {
            return Promise.reject(`Unknown network ${network}. Aborting!`);
        }
    }

    private async fetchCodesFromCloud(api: ApiPromise, projectId: string, bucket: string): Promise<Map<string, AccountId>> {
        // check 1Password entry for "Altair Referral Code Bucket Credentials"
        const GOOGLE_CLOUD_PRIVATE_KEY = this.gcloudPrivateKey;
        const GOOGLE_CLOUD_CLIENT_EMAIL = this.gcloudClientEmail;

        type ReferralCode = {
            referralCode: string;
            walletAddress: string;
        };

        const storage = new Storage({
            projectId: projectId,
            credentials: {
                client_email: GOOGLE_CLOUD_CLIENT_EMAIL,
                private_key: GOOGLE_CLOUD_PRIVATE_KEY,
            },
        });

        const referralCodeBucket = storage.bucket(bucket);

        const [files] = await referralCodeBucket.getFiles();

        this.logger.debug('Got ' + files.length + ' files.');
        this.logger.debug('Downloading files now. This will take a while...');

        let codes: Map<string, AccountId> = new Map();
        let counter = 0;
        for(const file of files){
            const content = await referralCodeBucket.file(file.name).download();

            const encoded = {
                walletAddress: api.createType("AccountId", content[0].toString('utf8')),
                referralCode: file.name.replace('.txt', '').slice(2),
            };
            counter++;
            this.logger.debug("Downloaded: " + counter + " of " + files.length + " \n    "
                + "{account: " + encoded.walletAddress.toHuman() + ", referralCode: " + encoded.referralCode + "}");

            codes.set(encoded.referralCode, encoded.walletAddress);

            // TODO: REMOVE
            if (counter == 20 ) {
                break;
            }
        }

        return codes;
    }

    private async generateContributions(): Promise<Map<AccountId, Balance>> {
        const maxContributions = BigInt(1_000_000_000_000_000_000_000_000); // 1_000_000 DAIR. This maxes the amount
        let contributions = BigInt(0);
        let contributors: Map<AccountId, Balance> = new Map();

        const keyring = new Keyring({ type: 'sr25519' });
        let counter = 0;

        while(contributions <= (BigInt(90) * maxContributions)/BigInt(100)) {
            let amount = ((BigInt(Math.floor(Math.random()*10)) * maxContributions)/BigInt(10000));

            if(amount + contributions <= maxContributions) {
                contributions += amount;

                counter += 1;
                let keypair = keyring.addFromUri(`TestAccount${counter}`);
                let account =  this.paraApi.createType("AccountId", compactAddLength(keypair.addressRaw));

                // Fill in storage which we will need to sign stuff later on
                this.syntheticAccounts.set(account, [keypair, amount]);

                // Transform to an actual contribution
                // We do NOT calculate referral or any other rewards here. As this is not part of the testing
                contributors.set(account, this.paraApi.createType("Balance", amount));
            }
        }

        return contributors
    }

    private static async generateMerkleTree(contributions: Map<AccountId, Balance>): Promise<MerkleTree> {
        type Data = {
            account: string,
            contribution: bigint
        };

        let unsortedHashesAndData: Array<[string, Data]> = new Array();

        for (const [account, contribution] of contributions){
            let data = account.toHex() + contribution.toHex().slice(2);
            unsortedHashesAndData.push([
                blake2AsHex(data, 256),
                {account: account.toHex(), contribution: contribution.toBigInt()}
            ]);
        }

        let sortedHashesAndData = unsortedHashesAndData.sort((a, b) => {
            // Sort the hashes alphabetically
            return ('' + a[0]).localeCompare(b[0]);
        })


        let tree = new Array();

        let sortedHashes = new Array();
        let sortedData = new Array();

        // split sortedHashes
        for (const [hash, data] of sortedHashesAndData) {
            sortedHashes.push(hash);
            sortedData.push(data);
        }


        let calculateNextLevel = (levelN: Array<string>): [Array<string>, string | undefined] => {
            let iterations = ((levelN.length + (levelN.length % 2)) / 2) - 1;

            let levelUp: Array<string> = new Array();

            let leftover;
            for(let i = 0; i <= iterations; i++) {
                // left is always available
                let left = levelN[i*2];

                if ((i*2 + 1) == levelN.length) {
                    leftover = left;
                } else {
                    let right = levelN[(i*2)+1];
                    levelUp.push(blake2AsHex(left + right.slice(2), 256));
                }
            }

            return [levelUp, leftover];
        }

        let currentDepth = sortedHashes

        // The first layer
        tree.unshift(currentDepth);

        while (currentDepth.length != 1) {
            let [nextLevel, leftOver] = calculateNextLevel(currentDepth);
            tree.unshift(nextLevel);
            currentDepth = leftOver === undefined ? nextLevel : nextLevel.concat(leftOver);
        }

        return {
            rootHash: tree[0][0],
            tree: tree.slice(1),
            data: sortedData,
        };
    }

    private static async parseMerkleTree(filePath: string): Promise<MerkleTree> {
        try {
            let file = fs.readFileSync(filePath);
            let tree: MerkleTree = JSONbig.parse(file.toString());

            if (tree.rootHash === undefined) {
                return Promise.reject("No rootHash found in parsed MerkleTree")
            }
            if (tree.data === undefined) {
                return Promise.reject("No data found in parsed MerkleTree")
            }
            if (tree.tree === undefined) {
                return Promise.reject("No tree found in parsed MerkleTree")
            }

            return tree;
        } catch (err) {
            return Promise.reject(err);
        }
    }
}