import {Command, flags} from '@oclif/command'
import {IConfig} from "@oclif/config";
import {ApiPromise, WsProvider, Keyring} from "@polkadot/api";
import {AccountId, Balance, EventRecord, Hash} from "@polkadot/types/interfaces";
import {KeyringPair} from "@polkadot/keyring/types";
import {GenericExtrinsic} from "@polkadot/types";
import {compactAddLength} from "@polkadot/util";
import { blake2AsHex } from "@polkadot/util-crypto";
import { Storage } from "@google-cloud/storage";
import * as fs from "fs";

const JSONbig = require('json-bigint')({ useNativeBigInt: true, alwaysParseAsBig: true });

import {fetchChildState, createDefaultChildStorageKey, Hasher} from "@centrifuge-cli/sp-state-fetch";
import {hexEncode, LeU32Bytes, toUtf8ByteArray, fromUtf8ByteArray} from "@centrifuge-cli/util"
import {CliBaseCommand} from "@centrifuge-cli/core";

import {Config, CrowdloanSpec, TransformConfig, Contributor, MerkleTree, Credentials} from "../crowdloan/interfaces";


export default class Crowdloan extends CliBaseCommand {
    // Configuration parsed from JSON
    crwdloanCfg!: Config

    // The api providing access to the parachain
    paraApi!: ApiPromise
    relayApi!: ApiPromise

    // This one will only be filled during generation of Keypairs if simulate is set
    syntheticAccounts: Map<AccountId, KeyringPair> = new Map()

    // The account that will initialize the pallets and also fund the reward pallet (sudo account)
    executor!: KeyringPair

    // These three one will be filled during parsing of credentials
    execPwd!: string
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
            description: 'the networks ws-endpoint of the relay chain',
            default: 'wss://rpc.polkadot.io'
        }),
        'para': flags.string({
            char: 'p',
            description: 'the networks ws-endpoint of the para chain',
            default: 'wss://fullnode-collator.charcoal.centrifuge.io'
        }),
        'config': flags.string({
            description: 'Path to a JSON-file that specifies the config for the crowdloan-modules and crowdloan data from relay-chain',
            required: true
        }),
        'creds': flags.string({
            description: 'Path to a JSON-file that specifies the passwords for the cloud-storage.',
            required: true
        }),
        'fetch-failed-events': flags.boolean({
            description: 'Solely used, when we want to update the state, due to some failing events at the beginning of Kusamas second crowdloan',
            default: false,
        }),
        'dry-run': flags.boolean({
            description: 'If present, the cli will generate the tree and spill out the amount of funding needed for the exec.',
            default: false,
        }),
        'tree-output': flags.string({
            description: 'If present, the cli will generate a JSON file containing the generated merkle tree. The argument is the path were tree is stored.',
            default: './outputs'
        }),
        'exec': flags.string({
            char: 'e',
            description: 'the path to the JSON-file of the account, that will initialize the crowdloan pallets on the parachain side',
            required: true
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

            this.crwdloanCfg = await Crowdloan.parseConfig(flags.config);

            this.logger.debug(this.crwdloanCfg)

            await this.parseCredentials(flags.creds, flags.simulate);

            this.executor = await this.parseAccountFromJson(flags.exec);

            this.paraApi = await Crowdloan.getApiPromise(flags.para);
            this.relayApi = await Crowdloan.getApiPromise(flags.relay);

            const contributions: Map<AccountId, Balance> = (flags.simulate)
                ? await this.generateContributions(this.relayApi)
                : await this.getContributions(this.relayApi, flags["fetch-failed-events"]);

            if (flags.simulate) {
                let file = './outputs/CROWDLOAN-syntheticContributors-' + Date.now() + '.json'
                let asArray = new Array();
                this.syntheticAccounts.forEach((keyPair, id) => asArray.push({account: id.toHex(), keyPair: keyPair.toJson()}));

                if(fs.existsSync('./outputs')) {
                    fs.writeFile(file, JSONbig.stringify(asArray, null, '\t'), err => {
                        if (err) {
                            this.logger.error("Error writing synthetic contributors to file. \n" + err)
                            this.logger.debug("Synthetic Contributors: \n" + JSONbig.stringify(asArray, null, '\t'));
                        }
                    });

                } else {
                    this.logger.warn("Folder '" + process.cwd()  +"/outputs' does not exist. Could not store Merkle-tree.")
                    this.logger.debug("Synthetic Contributors: \n" +  JSONbig.stringify(asArray, null, '\t'));
                }
            }

            const tree: MerkleTree = await Crowdloan.generateMerkleTree(contributions);
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

            const funding: Balance = await this.calculateFunding(contributions);

            const { data: execBalance } = await this.paraApi.query.system.account(this.executor.address);

            if (!flags["dry-run"]) {
                if (!(funding.toBigInt() <= execBalance.free.toBigInt())) {
                    const additional = this.paraApi.createType("Balance", funding.toBigInt() - execBalance.free.toBigInt());
                    throw new Error("Exec has " + execBalance.free.toHuman() + ". This is an insufficient balance. Needs " + additional.toHuman() + " more.")
                }

                await this.initializePallets(tree, funding.toBigInt());

                if(flags.test && flags.simulate) {
                    await this.runTest(contributions, tree);
                } else {
                    throw new Error("Unreachable Code...");
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
            this.relayApi.disconnect();
        } catch (err) {
            this.logger.error(err);
            // We need to manually disconnect here.
            try {
                this.paraApi.disconnect();
                this.relayApi.disconnect();
            } catch (err) {
                this.logger.error(err)
            }
        }

    }

    private async parseCredentials(filePath: string, isSimulate: boolean) {
        try {
            let file = fs.readFileSync(filePath);
            let credentials: Credentials = JSONbig.parse(file.toString());

        if (credentials.execPwd === undefined) {
            return Promise.reject("Missing password for executing account.");
        } else {
            this.execPwd = credentials.execPwd;
        }

        if (!isSimulate) {
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
        }

        } catch (err) {
            return Promise.reject(err);
        }
    }

    private async calculateFunding(contributions: Map<AccountId, Balance>): Promise<Balance> {
        let funding = BigInt(0);

        for (const amount of contributions.values()) {
            funding += amount.toBigInt();
        }

        // We increase by one as we want the PalletId to be kept alive on-chain
        return this.paraApi.createType("Balance", funding + BigInt(1));
    }

    private async parseAccountFromJson(filePath: string): Promise<KeyringPair> {
        let keyring = new Keyring();

        try {
            let file = fs.readFileSync(filePath);
            let executor = keyring.addFromJson(JSONbig.parse(file.toString()));

            executor.unlock(this.execPwd);
            return executor;
        } catch (err) {
            return Promise.reject(err);
        }

    }

    private static async getApiPromise(provider: string): Promise<ApiPromise> {
        try {
            const wsProvider = new WsProvider(provider);
            return  await ApiPromise.create({
                provider: wsProvider
            });
        } catch (err) {
            return Promise.reject(err)
        }
    }

    private static async parseConfig(file: string): Promise<Config> {
        try {
            const raw = fs.readFileSync(file);
            const config: Config = JSONbig.parse(raw.toString("utf-8"));
            await Crowdloan.checkConfig(config);
            return config;
        } catch (err) {
            return Promise.reject(err);
        }
    }

    private static async checkConfig(config: Config): Promise<void> {
        // Check Config
        if (config.crowdloans === undefined) {
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
        if (config.transformation.decimalDifference === undefined) {
            return Promise.reject("Missing `transformation.decimalDifference`")
        }
        if (config.transformation.conversionRate === undefined) {
            return Promise.reject("Missing `transformation.conversionRate`")
        }
        if (config.transformation.earlyBirdPrct === undefined) {
            return Promise.reject("Missing `transformation.earlyBirdPrct`")
        }
        if (config.transformation.earlyBirdBlock === undefined) {
            return Promise.reject("Missing `transformation.earlyBirdBlock`")
        }
        if (config.transformation.earlyHourPrct === undefined) {
            return Promise.reject("Missing `transformation.earlyHourPrct`")
        }
        if (config.transformation.referralUsedPrct === undefined) {
            return Promise.reject("Missing `transformation.referralUsedPrct`")
        }
        if (config.transformation.referedPrct === undefined) {
            return Promise.reject("Missing `transformation.referedPrct`")
        }
    }

    private async initializePallets(tree: MerkleTree, funding: bigint): Promise<void> {
        let rewardPalletAddr = await this.paraApi.consts.crowdloanReward.palletId.toHex();

        let finalized = false;
        let currentBlock = (await this.paraApi.rpc.chain.getHeader()).number.toBigInt();

        // Three extrinsics
        // 1. init pallet claim
        // 2. init pallet reward
        // 3. fund pallet reward
        let unsub = await this.paraApi.tx.sudo.sudo(
            this.paraApi.tx.utility.batchAll([
                this.paraApi.tx.crowdloanClaim.initialize(
                    tree.rootHash,
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
                this.paraApi.tx.balances.transfer(
                    rewardPalletAddr,
                    funding
                )
            ])
        ).signAndSend(this.executor, (result) => {
            if (result.status.isFinalized) {
                finalized = true;
                unsub();
            }
        });

        // We wait either till it is finalized or for 2 minutes -> 20*6s
        while (!finalized || currentBlock <= currentBlock + BigInt(20)) {
            await new Promise(r => setTimeout(r, 3000));
            currentBlock = (await this.paraApi.rpc.chain.getHeader()).number.toBigInt();
        }

        if(!finalized) {
            return Promise.reject("Pallets could not be initialized and funded. Aborting!")
        }
    }

    private async runTest(contributions: Map<AccountId, Balance>, tree: MerkleTree): Promise<void> {
        // TODO:
        this.logger.warn("Currently NO tests against pallets provided...");
    }

    private async getContributions(api: ApiPromise, isFailedEvents: boolean): Promise<Map<AccountId, Balance>> {
        const crowdloans: Array<CrowdloanSpec> = this.crwdloanCfg.crowdloans;

        let states: Map<bigint, Map<AccountId, [Balance, string]>> = new Map();
        for (const specs of crowdloans) {
            this.logger.debug("Specs: " + JSONbig.stringify(specs, null, '\t'));
            const hash = await api.rpc.chain.getBlockHash(specs.endBlock);

            // Check if hash belongs to a block else fail here
            try {
                const signedBlock = await api.rpc.chain.getBlock(hash);
            } catch (err) {
                return Promise.reject("Could not fetch a block for the given hash. Maybe wrong number or connected to Non-Archive-Node");
            }

            let data = await Crowdloan.fetchCrowdloanState(api, specs.trieIndex, hash);
            states.set(specs.trieIndex, data);
            this.logger.debug("Finished fetching " + data.size + " keys for crowdloan of paraId " + specs.paraId + " with index " + specs.trieIndex);
        }

        if (isFailedEvents) {
            this.logger.debug("Starting fetching failed events now...");
            // Update the correct state here this will always be for trieIndex 31
            if(states.has(BigInt(31))) {
                // If state has 31, then specs also contain 31. Qed.
                let config: CrowdloanSpec = this.crwdloanCfg.crowdloans.filter((spec) => {
                    spec.trieIndex === BigInt(31);
                })[0];

                // @ts-ignore // We not that 31 is a key in the map due to the check above.
                await this.updateStateFromFailedEvents(api, config, states.get(BigInt(31)));
            } else {
                this.logger.warn("Crowdloan with TrieIndex 31 not in states. Flag --fetch-failed-events is not effective...");
            }
            this.logger.debug("Finished fetching and updating with failed events.");
        }

        const contributors = await this.transformIntoContributors(api, states);

        // Transform depending on input
        return await this.transformIntoRewardee(contributors);
    }

    private async transformIntoContributors(api: ApiPromise, states: Map<bigint, Map<AccountId, [Balance, string]>>): Promise<Map<AccountId, Contributor>> {
        let previousState: Map<AccountId, [Balance, string]>;
        if (this.crwdloanCfg.crowdloans.length > 1) {
            let maybePreviousState = states.get(this.crwdloanCfg.crowdloans[1].trieIndex);

            if (maybePreviousState === undefined) {
                return Promise.reject("Crowdloan config indicates a crowdloan with TrieIndex " + this.crwdloanCfg.crowdloans[1].trieIndex + ". " +
                    "But this state has not been fetched. Aborting!");
            } else {
                previousState = maybePreviousState;
            }
        } else {
            previousState = new Map();
        }

        this.logger.debug("Fetching codes from gcloud now...");
        let codes = await this.fetchCodesFromCloud(api);
        this.logger.debug("Finished fetching codes from gcloud.");

        let state = states.get(this.crwdloanCfg.crowdloans[0].trieIndex);
        let contributions: Map<AccountId, Contributor> = new Map();
        let numReferrals: Map<AccountId, Array<AccountId>> = new Map();

        if (state === undefined) {
            return Promise.reject("No latest state fetched for latest crowdloan with TrieIndex " + this.crwdloanCfg.crowdloans[1].trieIndex +
                ". Aborting!");
        } else {
            for (const contributor of state.keys()) {
                let contributionAndMemo = state.get(contributor);

                if (contributionAndMemo === undefined) {
                    return Promise.reject("Can not be undefined. Qed.");
                } else {
                    let codesUser= codes.get(contributor);

                    if (codesUser === undefined) {
                        codesUser = new Array<string>();
                    }

                    let referred = false;
                    loop1:
                        for (const [user, codesOneUser] of codes) {
                    loop2:
                            for (const code of codesOneUser) {
                                if (contributionAndMemo[1] === code) {
                                    referred = true;

                                    if(numReferrals.has(user)) {
                                        let referrals = numReferrals.get(user);
                                        //@ts-ignore // We check this. Qed.
                                        referrals.push(contributor);
                                    } else {
                                        numReferrals.set(user, Array.from([contributor]));
                                    }
                                    break loop1;
                                }
                            }
                        }

                    contributions.set(contributor, {
                        account: contributor.toHex(),
                        contribution: contributionAndMemo[0].toBigInt(),
                        codes: codesUser,
                        referred: referred,
                        earlyHour: previousState.has(contributor),
                        whenContributed: this.crwdloanCfg.crowdloans[0].endBlock, // We init to last block, and update later
                        referrals: new Array(),
                    })
                }
            }

            // Now update the referral counts of each contributor
            for (const [account, contributor] of contributions) {
                    let referralsForThisAccount = numReferrals.get(account);
                    contributor.referrals.concat((referralsForThisAccount !== undefined) ? referralsForThisAccount : new Array());
            }

            await this.updateStateWithTimestamps(api, this.crwdloanCfg.crowdloans[0], contributions);
        }

        return contributions;
    }

    private async fetchCodesFromCloud(api: ApiPromise): Promise<Map<AccountId, string[]>> {
        // check 1Password entry for "Altair Referral Code Bucket Credentials"
        const GOOGLE_CLOUD_PRIVATE_KEY = this.gcloudPrivateKey;
        const GOOGLE_CLOUD_CLIENT_EMAIL = this.gcloudClientEmail;

        type ReferralCode = {
            referralCode: string;
            walletAddress: AccountId;
        };

        const getReferralCodesWithAddresses = async (): Promise<ReferralCode[]> => {
            const storage = new Storage({
                projectId: 'centrifuge-production-x',
                credentials: {
                    client_email: GOOGLE_CLOUD_CLIENT_EMAIL,
                    private_key: GOOGLE_CLOUD_PRIVATE_KEY,
                },
            });

            const referralCodeBucket = storage.bucket('altair_referral_codes');

            const [files] = await referralCodeBucket.getFiles();

            this.logger.debug('Got ' + files.length + ' files');

            const promises = files.map(async file => {
                const content = await referralCodeBucket.file(file.name).download();



                const encoded = {
                    walletAddress: api.createType("AccountId", content[0].toString('utf8')),
                    referralCode: file.name.replace('.txt', ''),
                };

                return encoded;
            });

            return Promise.all(promises);
        };


        const result = await getReferralCodesWithAddresses();

        let codes: Map<AccountId, string[]> = new Map();
        for (const {walletAddress, referralCode} of result ){
            if(codes.has(walletAddress)) {
                let referralCodes = codes.get(walletAddress);
                // @ts-ignore // we check that the entry exists
                referralCodes.push(referralCode);
            } else {
                let referralCodes = Array.from([referralCode]);
                codes.set(walletAddress, referralCodes);
            }
        }

        this.logger.debug("Fetched codes are:  " +  JSONbig.stringify(codes, null, '\t'));

        return codes;
    }

    /// This function takes Contributors class and actually generated the reward from this into for a given account
    private async transformIntoRewardee(contributors: Map<AccountId, Contributor>): Promise<Map<AccountId, Balance>> {
        const config = this.crwdloanCfg.transformation;
        let rewardees: Map<AccountId, Balance> = new Map();

        for(const [account, contributor] of contributors) {
            let contribution = contributor.contribution;

            if (contributor.referred) {
                contribution += (contribution * config.referedPrct)/BigInt(100);
            }

            for(const referral of contributor.referrals) {
                let referralContribution = contributors.get(referral);
                if (referralContribution !== undefined) {
                    contribution += (referralContribution.contribution * config.referralUsedPrct)/BigInt(100);
                } else {
                    this.logger.warn("Unreachable code. Referral account " + referral.toHuman() + " not fund in state-fetched contributions.");
                }
            }

            if(contributor.earlyHour) {
                // TODO: Do we provide a bonus here?
                contribution += (contribution * config.earlyHourPrct)/BigInt(100);
            }

            if (contributor.whenContributed <= config.earlyBirdBlock) {
                contribution += (contribution * config.earlyBirdPrct)/BigInt(100);
            }

            let afterConversion = config.decimalDifference * contribution;
            rewardees.set(account, this.paraApi.createType("Balance", afterConversion));
        }

        return rewardees;
    }

    private async generateContributions(api: ApiPromise): Promise<Map<AccountId, Balance>> {
        const maxContributions = 1000000000000000; // = 10,000 KSM. This maxes the amount we will have as AIR or CFT to 10,000 also
        let contributions = 0;
        let contributors: Map<AccountId, Balance> = new Map();

        const keyring = new Keyring({ type: 'sr25519' });
        let counter = 0;

        while(contributions <=  Math.floor(0.9 * maxContributions)) {
            let amount = Math.floor(Math.random() * maxContributions/10);

            if(amount + contributions <= maxContributions) {
                contributions += amount;

                counter += 1;
                let keypair = keyring.addFromUri(`TestAccount${counter}`);
                let account =  api.createType("AccountId", compactAddLength(keypair.addressRaw));

                // Fill in storage which we will need to sign stuff later on
                this.syntheticAccounts.set(account, keypair);

                // Transform to an actual contribution
                // We do NOT calculate referral or any other rewards here. As this is not part of the testing
                contributors.set(account, api.createType("Balance", BigInt(amount) * this.crwdloanCfg.transformation.decimalDifference));
            }
        }

        return contributors
    }

    private async updateStateFromFailedEvents(api: ApiPromise, config: CrowdloanSpec, state: Map<AccountId, [Balance, string]>): Promise<void> {
        let currentBlock = config.createBlock;
        this.logger.debug("Fetching block with number " + currentBlock);

        while(currentBlock <= config.endBlock) {
            this.logger.debug("Fetching block with number " + currentBlock);

            try {
                const blockHash = await api.rpc.chain.getBlockHash(currentBlock);
                const signedBlock = await api.rpc.chain.getBlock(blockHash);

                const allRecords = await api.query.system.events.at(signedBlock.block.header.hash);

                signedBlock.block.extrinsics.forEach((data, index) => {
                    if (data.method.section === "utility" && data.method.method === "batch") {
                        updateViaBatch(allRecords, data, index, currentBlock, state, config.paraId)
                            .catch(err => this.logger.warn(err));
                    }
                });

                currentBlock += BigInt(1);
            } catch (err) {
                return Promise.reject(err);
            }
        }

        async function updateViaBatch(
            allRecords: Array<EventRecord>,
            ext: GenericExtrinsic,
            index: number,
            at: bigint,
            state: Map<AccountId, [Balance, string]>,
            id: bigint
        ) {
            // Not catch the once that have failed
            const events = allRecords
                .filter(({ phase }) =>
                    phase.isApplyExtrinsic &&
                    phase.asApplyExtrinsic.eq(index)
                )
                .map((event) => {
                    if (event.event.section === "utility" && event.event.method === "BatchInterrupted") {
                        return event.event
                    }
                })
                .filter((entry) => entry !== undefined);

            for(const event of events) {
                // @ts-ignore
                let indexExtInBatch = event["data"][0].toBigInt();

                // Check if the failed extrinisc in the batch was an AddMemo call
                if(isAddMemo(ext, indexExtInBatch)) {
                    // @ts-ignore
                    let call = ext["method"]["args"][0][indexExtInBatch];

                    // get paraId here
                    let paraId =  call["args"][0].toBigInt();

                    if (paraId === id) {
                        try {
                            let referalCode = bytesToString(call["args"][1].toU8a(true)).replace(" ", "").split(":")[1];
                            // Get the account from the signature
                            // This cuts off the "0x" and some prefix of 2 bytes, which is there for codec reasons...
                            let account = api.createType("AccountId", "0x" + ext.signer.toHex().slice(4));

                            let contributor = state.get(account);

                            if (contributor !== undefined) {
                                contributor[1] = referalCode;
                            } else {
                                return Promise.reject("Failed to update Account " +  account.toHuman() + " with Memo: " + referalCode);
                            }
                        } catch (err) {
                            return Promise.reject(err);
                        }
                    }
                }
            }
        }

        function bytesToString(bytes: Array<number> | Uint8Array): string {
            let buff = Array.from(new Uint16Array(bytes));
            let asString = String.fromCharCode.apply(null, buff);
            return asString;
        }

        function isAddMemo(ext: GenericExtrinsic, index: number): boolean {
            // We know that the ext is a utility.batch call
            // Check here if we fail due to "MemoTooLarge"
            // @ts-ignore
            let call = ext["method"]["args"][0][index];

            let isAddMemo = false;
            if (call["method"] === "addMemo") {
                isAddMemo = true;
            }

            return isAddMemo;
        }
    }

    private async updateStateWithTimestamps(api: ApiPromise, config: CrowdloanSpec, state: Map<AccountId, Contributor>): Promise<void> {
        let currentBlock = config.createBlock;
        let updated: Map<AccountId, boolean> = new Map();

        while(currentBlock <= config.endBlock) {
            try {
                const blockHash = await api.rpc.chain.getBlockHash(currentBlock);
                const signedBlock = await api.rpc.chain.getBlock(blockHash);

                const allRecords = await api.query.system.events.at(signedBlock.block.header.hash);

                signedBlock.block.extrinsics.forEach((data, index) => {
                    if(data.method.section === "crowdloan") {
                        updateViaDirect(allRecords, index, currentBlock, state, updated)
                            .catch((err) => {
                                this.logger.error(err);
                                throw new Error("Fatal: Found event with contribution that was not in the fetched state from storage. Aborting!");
                            });
                    }
                });

                currentBlock += BigInt(1);
            } catch (err) {
                return Promise.reject(err);
            }
        }

        async function updateViaDirect(
            allRecords: Array<EventRecord>,
            index: number,
            at: bigint,
            state: Map<AccountId, Contributor>,
            updated: Map<AccountId, boolean>
        ) {
            // filter the specific events based on the phase and then the
            // index of our extrinsic in the block
            const events = allRecords
                .filter(({ phase }) =>
                    phase.isApplyExtrinsic &&
                    phase.asApplyExtrinsic.eq(index)
                )
                .map((event) => {
                    if (event.event.section === "crowdloan") {
                        return event.event
                    }
                })
                .filter((entry) => entry !== undefined);

            for (const event of events) {
                // @ts-ignore // We know, due to the filter, that events does NOT contain undefined
                if (event.method === "Contributed") {
                    //@ts-ignore
                    if (event["data"][1].toBigInt() === BigInt(PARA_ID)) {
                        //@ts-ignore
                        let account = api.createType("AccountId", event["data"][0].toHex());

                        if (!updated.has(account)) {
                            updated.set(account, true);
                            let contributor = state.get(account);

                            if (contributor === undefined) {
                                return Promise.reject("Account " + account.toHuman() + " is found in Events but not in the fetched state.");
                            } else {
                                contributor.whenContributed = at;
                            }
                        }
                    }
                }
            }
        }
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
            rootHash: tree[0],
            tree: tree.slice(1),
            data: sortedData,
        };
    }

    private static async fetchCrowdloanState(api: ApiPromise, trieIndex: bigint, at: Hash): Promise<Map<AccountId, [Balance, string]>> {
        let crowdloanData = new Map();
        let levels: Array<[string | Uint8Array, Hasher]> = [
            [Uint8Array.from(Array.from(await toUtf8ByteArray("crowdloan")).concat(Array.from(LeU32Bytes(trieIndex)))), Hasher.Blake2_256],
        ];

        const key = await createDefaultChildStorageKey(api, levels);
        const contributions = await fetchChildState(api, key, at);

        if(contributions.length > 0) {
            crowdloanData.set(trieIndex, new Map());
            let data = crowdloanData.get(trieIndex);

            for (const contr of contributions) {
                //@ts-ignore
                const account = api.createType("AccountId", "0x" + contr[0].toHex().slice(-64));
                //@ts-ignore
                const contributionAndMemo: [Balance, Uint8Array] = api.createType("(Balance, Vec<u8>)", contr[1]);

                crowdloanData.set(account, [contributionAndMemo[0], fromUtf8ByteArray(contributionAndMemo[1])])
            }
        }

        return crowdloanData
    }
}