import {Command, flags} from '@oclif/command'
import {CliBaseCommand} from "@centrifuge-cli/core";
import {IConfig} from "@oclif/config";
import {ApiPromise, WsProvider, Keyring} from "@polkadot/api";
import {AccountId, Balance, EventRecord, Hash} from "@polkadot/types/interfaces";
import {KeyringPair} from "@polkadot/keyring/types";
import {GenericExtrinsic} from "@polkadot/types";


import {fetchChildState, createDefaultChildStorageKey, Hasher} from "@centrifuge-cli/sp-state-fetch";
import {hexEncode, LeU32Bytes, toUtf8ByteArray, fromUtf8ByteArray} from "@centrifuge-cli/util"
import * as fs from "fs";

import {Config, CrowdloanSpec, TransformConfig, Contributor, MerkleTree} from "../crowdloan/interfaces";
import readline from "readline";

export default class Crowdloan extends CliBaseCommand {
    // Configuration parsed from JSON
    crwdloanCfg!: Config

    // The api providing access to the parachain
    paraApi!: ApiPromise

    // This one will only be filled during generation of Keypairs if simulate is set
    syntheticAccounts: Map<AccountId, KeyringPair> = new Map()

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
            required: true
        }),
        'para': flags.string({
            char: 'p',
            description: 'the networks ws-endpoint of the para chain',
            required: true
        }),
        'config': flags.string({
            description: 'Path to a JSON-file that specifies the config for the crowdloan-modules and crowdloan data from relay-chain',
            required: true
        }),
        'fetch-failed-events': flags.boolean({
           description: 'Solely used, when we want to update the state, due to some failing events at the beginning of Kusamas second crowdloan'
        }),
        'dry-run': flags.boolean({
            description: 'If present, the cli will generate the tree and spill out the amount of funding needed for the exec.',
        }),
        'tree-output': flags.string({
            description: 'If present, the cli will generate a JSON file containing the generated merkle tree. The argument is the path were tree is stored.',
        }),
        'exec': flags.string({
            char: 'e',
            description: 'the path to the JSON-file of the account, that will initialize the crowdloan pallets on the parachain side',
            required: true
        }),
        'simulate':  flags.boolean({
            description: 'if present, the data from the contributions will be simulated and not fetched from a relay chain',
            exclusive: ['relay']
        }),
        'test': flags.boolean({
            description: 'if present, a randomly sized set of the contributions will run reward-calls against the chain. Generated accounts will be funded from exec.',
            dependsOn: ['simulate'],
            exclusive: ['dry-run']
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

            const exec: KeyringPair = await Crowdloan.parseAccountFromJson(flags.exec);

            this.paraApi = await Crowdloan.getApiPromise(flags.para);

            const contributions: Map<AccountId, Balance> = (flags.simulate)
                ? await this.generateContributions()
                : await this.getContributions(await Crowdloan.getApiPromise(flags.relay), flags["fetch-failed-events"]);

            const tree: MerkleTree = await Crowdloan.generateMerkleTree(contributions);
            if(flags["tree-output"] !== undefined) {
                if(fs.existsSync(flags["tree-output"])) {
                    fs.writeFile(flags["tree-output"], JSON.stringify(tree), err => {
                        this.logger.error("Error writing Merkle-tree to file. " + err);
                        return
                    });
                } else {
                    this.logger.warn("Folder " + flags["tree-output"] + " does not exist. Could not store Merkle-tree.")
                }

                this.logger.debug("Merkle Tree: \n" + JSON.stringify(tree));
            }

            const funding: Balance = await this.calculateFunding(contributions);

            const { data: execBalance } = await this.paraApi.query.system.account(exec.address);

            if (!flags["dry-run"]) {
                if (!(funding.toBigInt() <= execBalance.free.toBigInt())) {
                    const additional = this.paraApi.createType("Balance", funding.toBigInt() - execBalance.free.toBigInt());
                    throw new Error("Exec has " + execBalance.free.toHuman() + ". This is an insufficient balance. Needs " + additional.toHuman() + " more.")
                }

                if (!flags.test) {
                    await this.initializePallets(tree);
                } else if(flags.test && flags.simulate) {
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
        } catch (err) {
            this.logger.error(err);
        }

    }

    private async calculateFunding(contributions: Map<AccountId, Balance>): Promise<Balance> {
        let funding = BigInt(0);

        for (const amount of contributions.values()) {
            funding += amount.toBigInt();
        }

        return this.paraApi.createType("Balance", funding);
    }

    private static async parseAccountFromJson(filePath: string): Promise<KeyringPair> {
        let keyring = new Keyring();

        try {
            let file = fs.readFileSync(filePath);
            let executor = keyring.addFromJson(JSON.parse(file.toString()));

            let pwd;
            let isRead = false;
            await capturePwd(isRead, (password) => {
                pwd = password;
            });

            while (!isRead){
                // Loop till user input is read...
                await new Promise(r => setTimeout(r, 500));
            }
            executor.unlock(pwd);

            return executor;
        } catch (err) {
            return Promise.reject(err);
        }

        async function capturePwd(isRead: boolean, cb: (str: string) => void) {
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });

            rl.question('Please provide the password for JSON-account-file: ', function(password) {
                // @ts-ignore
                rl.output.write("\n");
                // @ts-ignore
                rl.history.slice(1);
                rl.close();
                isRead = true;
                cb(password);
            });
            // @ts-ignore
            rl._writeToOutput = function _writeToOutput(stringToWrite) {
                // @ts-ignore
                rl.output.write("*");
            };
        }
    }

    private static async getApiPromise(provider: string): Promise<ApiPromise> {
        const wsProvider = new WsProvider(provider);//'wss://fullnode-collator.charcoal.centrifuge.io');rpc.polkadot.i
        return  await ApiPromise.create({
            provider: wsProvider
        });
    }

    private static async parseConfig(file: string): Promise<Config> {
        try {
            const raw = fs.readFileSync(file);
            const config: Config = JSON.parse(raw.toString());
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

    private async initializePallets(tree: MerkleTree): Promise<void> {
        // TODO:
    }

    private async runTest(contributions: Map<AccountId, Balance>, tree: MerkleTree): Promise<void> {
        // TODO:
    }

    private async getContributions(api: ApiPromise, isFailedEvents: boolean): Promise<Map<AccountId, Balance>> {
        const crowdloans: Array<CrowdloanSpec> = this.crwdloanCfg.crowdloans;

        let states: Map<number, Map<AccountId, [Balance, string]>> = new Map();
        for (const specs of crowdloans) {
            const hash = await api.rpc.chain.getBlockHash(specs.endBlock);

            // Check if hash belongs to a block else fail here
            try {
                const signedBlock = await api.rpc.chain.getBlock(hash);
            } catch (err) {
                return Promise.reject("Could not fetch a block for the given hash. Maybe wrong number or connected to Non-Archive-Node");
            }

            states.set(specs.trieIndex, await Crowdloan.fetchCrowdloanState(api, specs.trieIndex, hash));
        }

        if (isFailedEvents) {
            // Update the correct state here this will always be for trieIndex 31
            if(states.has(31)) {
                // If state has 31, then specs also contain 31. Qed.
                let config: CrowdloanSpec = this.crwdloanCfg.crowdloans.filter((spec) => {
                    spec.trieIndex === 31;
                })[0];

                // @ts-ignore // We not that 31 is a key in the map due to the check above.
                await this.updateStateFromFailedEvents(api, config, states.get(31));
            } else {
                this.logger.warn("Crowdloan with TrieIndex 31 not in states. Flag --fetch-failed-events is not effective...");
            }
        }

        const contributors = await this.transformIntoContributors(api, states);

        // Transform depending on input
        return await this.transformIntoRewardee(contributors);
    }

    private async transformIntoContributors(api: ApiPromise, states: Map<number, Map<AccountId, [Balance, string]>>): Promise<Map<AccountId, Contributor>> {
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

        let codes = await Crowdloan.fetchCodesFromCloud();

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

    private static async fetchCodesFromCloud(): Promise<Map<AccountId, string[]>> {
        // TODO: Probably we need some identifier for a crowdloan in the cloud or simpy delete the old data...
        return new Map();
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

    private async generateContributions(): Promise<Map<AccountId, Balance>> {
        // Randomly choose a number of contributors

        // Generate this number of accounts with paraAPI - as we are both on AccountId32 this is fine

        // Generate a random contrubution for each of the accounts

        // Output data

        // TODO:
        return new Map()
    }

    private async updateStateFromFailedEvents(api: ApiPromise, config: CrowdloanSpec, state: Map<AccountId, [Balance, string]>): Promise<void> {
        let currentBlock = config.createBlock;
        while(currentBlock <= config.endBlock) {
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
            id: number
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
        // TODO: Generate Merkle tree here
        return {};
    }

    private static async fetchCrowdloanState(api: ApiPromise, trieIndex: number, at: Hash): Promise<Map<AccountId, [Balance, string]>> {
        let crowdloanData = new Map();
        let levels: Array<[string | Uint8Array, Hasher]> = [
            [Uint8Array.from(Array.from(await toUtf8ByteArray("crowdloan")).concat(Array.from(LeU32Bytes(trieIndex)))), Hasher.Blake2_128],
        ];

        let key = await createDefaultChildStorageKey(api, levels);
        let contributions = await fetchChildState(api, key, at);

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