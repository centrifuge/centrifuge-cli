import {Command, flags} from '@oclif/command'
import {IConfig} from "@oclif/config";
import {ApiPromise, WsProvider, Keyring} from "@polkadot/api";
import {EventRecord, Extrinsic, Hash} from "@polkadot/types/interfaces";
import {KeyringPair} from "@polkadot/keyring/types";
import { blake2AsHex } from "@polkadot/util-crypto";
import {decodeAddress, encodeAddress} from "@polkadot/keyring";
import { Client, Configuration } from 'ts-postgres';
import * as fs from "fs";
import {cryptoWaitReady} from "@polkadot/util-crypto"
import {getContributions as getContributionsKusama} from "../crowdloan/kusama";
import {getContributions as getContributionsPolkadot} from "../crowdloan/polkadot";
import { parse } from 'csv-parse';
import '@polkadot/api-augment'

const JSONbig = require('json-bigint')({ useNativeBigInt: true, alwaysParseAsBig: true });

import {
    hexEncode,
    LeU32Bytes,
    toUtf8ByteArray,
    fromUtf8ByteArray,
    hexDecode,
    LeU64Bytes,
    LeU128Bytes
} from "@centrifuge-cli/util"
import {CliBaseCommand} from "@centrifuge-cli/core";

import {
    Config,
    MerkleTree,
    Credentials,
    Proof,
    Signature, Contribution,
    Balance, AccountId, Additionals, Removals
} from "../crowdloan/interfaces";
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

    sqlCfg!: Configuration

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
            required: true,
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
        'tree-output': flags.boolean({
            description: 'If present, the cli will output the generated merkle tree to logs.',
            default: false,
        }),
        'run-from-tree': flags.string({
            description: 'Allows to initialize the pallets with a tree previsouly created with this script',
            exclusive: ['simulate']
        }),
        'append-tree': flags.string({
            description: 'Allows to append data that should go into a merkle-tree, that are not coming from contributions.',
            exclusive: ['simulate']
        }),
        'remove-tree': flags.string({
            description: 'Allows to remove data from the merkle-tree.',
            exclusive: ['simulate']
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

            this.logger.info("Connecting to chain " + flags.para);
            this.paraApi = await Crowdloan.getApiPromise(flags.para, {
                RootHashOf: 'Hash',
                TrieIndex: 'u32',
                RelayChainAccountId: 'AccountId',
                ParachainAccountIdOf: 'AccountId',
                Proof: {
                    leafHash: 'Hash',
                    sortedHashes: 'Vec<Hash>'
                }
            });

            this.crwdloanCfg = await Crowdloan.parseConfig(flags.relay, flags.config);

            this.logger.debug(this.crwdloanCfg)

            await this.parseCredentials(flags.creds);

            let contributions: Map<AccountId, Balance>;
            if (flags['run-from-tree'] === undefined) {
                this.logger.info("Generating contributions.");
                 contributions = (flags.simulate)
                    ? await this.generateContributions()
                    : await this.getContributions(flags.relay);

                if(flags['append-tree'] !== undefined) {
                    await this.appendContributions(contributions, flags["append-tree"]);
                }

                if(flags['remove-tree'] !== undefined) {
                    await this.removeContributions(contributions, flags["remove-tree"]);
                }

                if (flags.simulate) {
                    let asArray = new Array();
                    this.syntheticAccounts.forEach(([keyPair, amount], id) => {
                        asArray.push({
                            account: id,
                            keyPair: keyPair.toJson(),
                            contribution: amount
                        });
                    });

                    let fileName = 'syntheticContributors-' + Date.now() + '.json';
                    try {
                        this.writeFile(JSONbig.stringify(asArray, null, '\t'), fileName, 'SyntheticContributors');
                    } catch (err) {
                        this.logger.warn("Error writing file. " + err);
                        this.logger.debug("Synthetic contributors: \n" +JSONbig.stringify(asArray, null, '\t'));
                    }
                }
            }

            this.logger.info("Creating Merkle Tree.");
            const tree: MerkleTree = (flags['run-from-tree'] === undefined)
                // @ts-ignore // We assign "contribution" above, when have flag NOT set
                ? await Crowdloan.generateMerkleTree(contributions)
                : await Crowdloan.parseMerkleTree(flags['run-from-tree'])

            // Storing tree always
            try {
                const fileName = 'MerkleTree-' + Date.now() + '.json';
                this.writeFile(JSONbig.stringify(tree, null, '\t'), fileName, 'MerkleTrees');
            } catch (err) {
                this.logger.warn("Error writing file. " + err);
                this.logger.debug("Merkle tree: \n" +JSONbig.stringify(tree, null, '\t'));
            }

            if(flags["tree-output"]) {
                this.logger.info("Merkle tree: \n" +JSONbig.stringify(tree, null, '\t'));
            }

            const funding = await this.calculateFunding(tree);

            this.logger.info("Accumulated rewards are " + this.paraApi.createType("Balance", funding).toHuman());
            if (!flags["dry-run"]) {
                await this.initializePallets(tree, funding);

                if(flags.test && flags.simulate) {
                    this.logger.info("Starting to run tests now.");
                    await this.runTest(tree);
                }
            }

            await this.paraApi.disconnect();
        } catch (err) {
            this.logger.error(err);
            // We need to manually disconnect here.
            try {
                await this.paraApi.disconnect();
            } catch (err) {
                this.logger.error(err);
                this.exit(2);
            }

            this.exit(2);
        }
        this.logger.info("Crowdloan command finished.");
        return;
    }

    private async parseCredentials(filePath: string) {
        try {
            let file = fs.readFileSync(filePath);
            let credentials: Credentials = JSONbig.parse(file.toString());

            if (credentials.executorURI === undefined) {
                return Promise.reject("Missing URI for executor account");
            }

            this.executor = await this.parseAccountFromURI(credentials.executorURI);

            if (credentials.sqlCfg === undefined) {
                return Promise.reject("Missing sql configuration");
            }

            this.sqlCfg = credentials.sqlCfg;

        } catch (err) {
            return Promise.reject(err);
        }
    }

    private async calculateFunding(contributions: MerkleTree): Promise<Balance> {
        let funding = BigInt(0);

        for (const {contribution} of contributions.data) {
            funding += contribution;
        }

        return funding;
    }

    private async parseAccountFromURI(uri: string): Promise<KeyringPair> {
        const keyring = new Keyring({type: 'sr25519'});

        if(!await cryptoWaitReady()) {
            return Promise.reject("Could not initialize WASM environment for crypto. Aborting!");
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
        let finalized = false;
        let startBlock = (await this.paraApi.rpc.chain.getHeader()).number.toBigInt();

        // Three extrinsics
        // 1. init pallet claim
        // 2. init pallet reward
        // 3. fund pallet reward
        try {
            let unsubInit = await this.paraApi.tx.sudo.sudo(
                this.paraApi.tx.utility.batchAll([
                    this.paraApi.tx.crowdloanClaim.initialize(
                        tree.rootHash,
                        this.crwdloanCfg.claimPallet.locketAt,
                        this.crwdloanCfg.claimPallet.index,
                        this.crwdloanCfg.claimPallet.leaseStart,
                        this.crwdloanCfg.claimPallet.leasePeriod
                    ),
                    this.paraApi.tx.crowdloanReward.initialize(
                        this.crwdloanCfg.rewardPallet.directPayoutRatio * BigInt(10_000_000),
                        this.crwdloanCfg.rewardPallet.vestingPeriod,
                        this.crwdloanCfg.rewardPallet.vestingStart,
                    )
                ])
            ).signAndSend(this.executor, (result) => {
                if (result.status.isFinalized) {
                    finalized = true;
                    unsubInit();
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

        // Prepare Error Claims
        let errorClaims: Array<[any, number]> = [];
        for (const [id, [key, amount]] of this.syntheticAccounts)  {
            const proof =  await Crowdloan.createProof(tree, id);

            // Get a random number between 1 and 100
            let rnd = Math.floor(Math.random()*100);

            let signature;
            let relayChainAccount;
            let proofT;
            let amountT;
            let errorSignal;

            if (0 <= rnd && rnd < 20) {
                // Normal double claim
                signature = await Crowdloan.createSignature(key, id);
                // @ts-ignore
                proofT = this.paraApi.createType("Proof", {
                    leafHash: this.paraApi.createType("Hash",proof.leafHash),
                    sortedHashes: this.paraApi.createType("Vec<Hash>", proof.sortedHashes)
                });
                amountT = this.paraApi.createType("Balance", amount);
                relayChainAccount = id;

                errorSignal = 1;
            } else if (20 <= rnd && rnd < 40) {
                // Wrong signature
                signature = await Crowdloan.createSignature(key, Uint8Array.from([0,0,0,0,0,0,0]));
                // @ts-ignore
                proofT = this.paraApi.createType("Proof", {
                    leafHash: this.paraApi.createType("Hash",proof.leafHash),
                    sortedHashes: this.paraApi.createType("Vec<Hash>", proof.sortedHashes)
                });
                amountT = this.paraApi.createType("Balance", amount);
                relayChainAccount = id;

                errorSignal = 2;
            } else if (40 <= rnd && rnd < 60) {
                // Wrong amount
                signature = await Crowdloan.createSignature(key, id);
                // @ts-ignore
                proofT = this.paraApi.createType("Proof", {
                    leafHash: this.paraApi.createType("Hash",proof.leafHash),
                    sortedHashes: this.paraApi.createType("Vec<Hash>", proof.sortedHashes)
                });
                amountT = this.paraApi.createType("Balance", amount + BigInt(rnd));
                relayChainAccount = id;

                errorSignal = 3;
            } else if (60 <= rnd && rnd < 80) {
                // Wrong proof
                signature = await Crowdloan.createSignature(key, id);
                let wrongHashes = proof.sortedHashes;
                wrongHashes[0] = "0xbbbbbbbbbbbbbrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr";
                // @ts-ignore
                proofT = this.paraApi.createType("Proof", {
                    leafHash: this.paraApi.createType("Hash",proof.leafHash),
                    sortedHashes: this.paraApi.createType("Vec<Hash>", wrongHashes)
                });
                amountT = this.paraApi.createType("Balance", amount + BigInt(rnd));
                relayChainAccount = id;

                errorSignal = 3;
            } else if (80 <= rnd && rnd < 100) {
                // Wrong account
                signature = await Crowdloan.createSignature(key, id);
                // @ts-ignore
                proofT = this.paraApi.createType("Proof", {
                    leafHash: this.paraApi.createType("Hash",proof.leafHash),
                    sortedHashes: this.paraApi.createType("Vec<Hash>", proof.sortedHashes)
                });
                amountT = this.paraApi.createType("Balance", amount);
                relayChainAccount = this.paraApi.createType("AccountId", [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,]);

                errorSignal = 2;
            } else {
                return Promise.reject("Unrechable code. Qed.");
            }

            // @ts-ignore
            const sigTSr25519 = this.paraApi.createType("Sr25519Signature", signature.signature);
            const sigTMultiSig = this.paraApi.createType("MultiSignature", {sr25519: sigTSr25519});


            try {
                errorClaims.push(
                    [
                        this.paraApi.tx.crowdloanClaim.claimReward(
                            relayChainAccount,
                            id,
                            sigTMultiSig,
                            proofT,
                            amountT
                        ),
                        errorSignal
                    ]
                );
            } catch (err) {
                this.logger.error(err);
            }
        }

        const batchError = 100;
        let counterError = 0;
        for (const [xt, signal] of errorClaims) {
            if(counterError % batchError === 0) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }

            // Send all claims that are not double claim
            if (signal !== 1) {
                try {
                    await xt.send();
                } catch (err) {
                    // @ts-ignore1010:
                    const numAsString = err.message.replace("1010: Invalid Transaction: Custom error: ", "").trim();
                    try {
                        const errorNum = parseInt(numAsString);
                        if(errorNum !== signal) {
                            this.logger.error("Error signal was not expected. Wanted: " + signal+ ", got: " + errorNum);
                        } else {
                            this.logger.info("Failed correctly with signal " + signal);
                        }
                    } catch (err) {
                        this.logger.error("Could not retrieve error signal. Got: \n" + err);
                    }
                }
            }

            counterError++;
        }


        let claims = [];
        // Claim correctly first for all
        for (const [id, [key, amount]] of this.syntheticAccounts) {
            const proof = await Crowdloan.createProof(tree, id);

            const signature = await Crowdloan.createSignature(key, id);

            let sigTMultiSig;
            if (key.type == "sr25519") {
                this.logger.debug("Creating Sr25519 signature. For account " + id);
                const sigTSr25519 = this.paraApi.createType("Sr25519Signature", '0x' + hexEncode(signature.signature));
                sigTMultiSig = this.paraApi.createType("MultiSignature", {sr25519: sigTSr25519});
            } else if (key.type == "ed25519") {
                this.logger.debug("Creating Ed25519 signature. For account " + id);
                const sigTEd25519 = this.paraApi.createType("Ed25519Signature", '0x' + hexEncode(signature.signature));
                sigTMultiSig = this.paraApi.createType("MultiSignature", {ed25519: sigTEd25519});
            } else {
                this.logger.debug("Creating Ecdsa signature. For account " + id);
                const sigTEcdsa = this.paraApi.createType("EcdsaSignature", '0x' + hexEncode(signature.signature));
                sigTMultiSig = this.paraApi.createType("MultiSignature", {ecdsa: sigTEcdsa});
            }

            // @ts-ignore
            const proofT = this.paraApi.createType("Proof", {
                leafHash: this.paraApi.createType("Hash", proof.leafHash),
                sortedHashes: this.paraApi.createType("Vec<Hash>", proof.sortedHashes)
            });
            const amountT = this.paraApi.createType("Balance", amount);

            try {
                claims.push(
                    this.paraApi.tx.crowdloanClaim.claimReward(
                        id,
                        id,
                        sigTMultiSig,
                        proofT,
                        amountT
                    )
                );
            } catch (err) {
                this.logger.error(err);
            }
        }

        const batch = 100;
        let counter = 0;
        for (const xt of claims) {
            if(counter % batch === 0) {
                await new Promise(resolve => setTimeout(resolve, 12000));
            }

            try {
                this.logger.info("Claiming correctly...");
                await xt.send();
            } catch (err) {
                this.logger.error(err);
            }

            counter++;
        }


        const batchDoubleClaim = 100;
        let counterDoubleClaim = 0;
        for (const [xt, signal] of errorClaims) {
            if(counterDoubleClaim % batchDoubleClaim === 0) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }

            // Send all claims that are double claim
            if (signal === 1) {
                try {
                    await xt.send();
                } catch (err) {
                    // @ts-ignore
                    const numAsString = err.message.replace("1010: Invalid Transaction: Custom error: ", "").trim();
                    try {
                        const errorNum = parseInt(numAsString);
                        if(errorNum !== signal) {
                            this.logger.error("Error signal was not expected. Wanted: " + signal+ ", got: " + errorNum);
                        } else {
                            this.logger.info("Failed correctly with signal " + signal);
                        }
                    } catch (err) {
                        this.logger.error("Could not retrieve error signal. Got: \n" + err);
                    }
                }
            }

            counterDoubleClaim++;
        }


    }

    private static async createProof(tree: MerkleTree, id: string): Promise<Proof> {
        let startIndex;
        let contr =  tree.data.filter((val, idx) => {
            if (val.account === id ) {
                startIndex = idx;
                return true;
            }

            return false;
        })

        if (startIndex === undefined || contr.length !== 1) {
            return Promise.reject("Tree not generated correctly.");
        }

        let sortedHashes = [];
        let currDepth = tree.tree.length - 1;
        let index: number = startIndex;
        while(currDepth >= 0) {
            // Check if in this round we have the last element of this row and uneven row
            if (index === tree.tree[currDepth].length - 1 && tree.tree[currDepth].length % 2 === 1 ){
                // Count the number of uneven rows above your row and then decide to go up- or downwards
                let numUnevenRows = 0;
                // If we are not in the last row, do the count. If we are, then there are zero uneven rows above us and
                // we need to go downwards anyways.
                if (currDepth !== 0) {
                    for (let i = currDepth - 1; i >= 0; i--) {
                        if (tree.tree[i].length % 2 === 1) {
                            numUnevenRows++
                        }
                    }
                }

                let down = (numUnevenRows % 2) === 0;

                // Ensure we are not in the base row of the tree.
                if (down) {
                    // If last and first element we must find the first uneven row below and take this one.
                    // Check first row below yourself for unevenness, and if so take the last element
                    let i = currDepth + 1;
                    let found = false;
                    while(i < tree.tree.length) {
                        const lengthThisDepth = tree.tree[i].length;
                        if(lengthThisDepth % 2 === 1) {
                            sortedHashes.push(tree.tree[i][lengthThisDepth - 1])
                            found = true;
                            break
                        }
                        i++;
                    }
                    if (!found) {
                        return Promise.reject("Algorithm for proof generation not working.");
                    }
                } else {
                    // Check first row above yourself for unevenness, and if so take the last element
                    let i = currDepth - 1;
                    let found = false;
                    while (i >= 0) {
                        const lengthThisDepth = tree.tree[i].length;
                        if (lengthThisDepth % 2 === 1) {
                            sortedHashes.push(tree.tree[i][lengthThisDepth - 1])
                            found = true;
                            break
                        }
                        i--;
                    }
                    if (!found) {
                        return Promise.reject("Algorithm for proof generation not working.");
                    }

                    index = tree.tree[i].length;
                    currDepth = i;
                }
            } else {
                // If we are even then push the right element, else the left one
                if (index % 2 === 0) {
                    sortedHashes.push(tree.tree[currDepth][index + 1]);
                } else {
                    sortedHashes.push(tree.tree[currDepth][index - 1]);
                }
            }

            index = (index - (index % 2)) / 2;
            currDepth--;
        }

        return {
            leafHash: tree.tree[tree.tree.length - 1][startIndex],
            sortedHashes: sortedHashes
        }
    }

    private static async createSignature(key: KeyringPair, msg: string | Uint8Array): Promise<Signature> {
        return {
            signer: key.address,
            msg: msg,
            signature: key.sign(msg)
        }
    }

    private async getContributions(network: string): Promise<Map<AccountId, Balance>> {
        if (network === 'Kusama') {
            return getContributionsKusama(
                this.paraApi,
                this.crwdloanCfg.crowdloans,
                this.crwdloanCfg.transformation.kusama,
                this.logger.getChildLogger({name: "Crowdloan - Kusama"}),
                this.sqlCfg
            );
        } else if (network === 'Polkadot') {
            return getContributionsPolkadot(this.paraApi,
                this.crwdloanCfg.crowdloans,
                this.crwdloanCfg.transformation.polkadot,
                this.logger.getChildLogger({name: "Crowdloan - Polkadot"}),
                this.sqlCfg
            );
        } else {
            return Promise.reject(`Unknown network ${network}. Aborting!`);
        }
    }

    static async fetchAddressCodesSets(table: string, sqlCfg: Configuration): Promise<Map<string, Array<string>>> {
        let data = new Map();

        const client = new Client(sqlCfg);
        await client.connect();

        const results = client.query(`
           SELECT wallet_address, referral_code FROM ${table} 
        `);

        for await (const row of results) {
            // @ts-ignore
            const addressSS58: string = row.data[0];
            const decoded = decodeAddress(addressSS58);
            const address = '0x' + hexEncode(decoded);
            // @ts-ignore
            const code: string = row.data[1];

            data.has(address) ? data.get(address).push(code) : data.set(address, Array.from([code]));
        }

        client.end().then((info) => console.log("Disconnected from sql-db. Info: " + info)).catch((err) => console.error(err));
        return data;
    }

    static async fetchCodeAddressPairs(table: string, sqlCfg: Configuration): Promise<Map<string, string>> {
        let data = new Map();

        const client = new Client(sqlCfg);
        await client.connect();

        const results = client.query(`
           SELECT wallet_address, referral_code FROM ${table} 
        `);

        for await (const row of results) {
            // @ts-ignore
            const addressSS58: string = row.data[0];
            const decoded = decodeAddress(addressSS58);
            const address = '0x' + hexEncode(decoded);
            // @ts-ignore
            const code: string = row.data[1];

            if (data.has(code)) {
                return Promise.reject("Inconsistent DB. Double code value")
            } else {
                data.set(code, address);
            }
        }

        client.end().then((info) => console.log("Disconnected from sql-db. Info: " + info)).catch((err) => console.error(err));
        return data;
    }

    static async fetchAddressFromCode(code: string, table: string, sqlCfg: Configuration): Promise<string | undefined> {
        const client = new Client(sqlCfg);
        await client.connect();

        if (code === "") {
            return;
        }

        const results = client.query(`
            SELECT wallet_address FROM ${table} WHERE referral_code='${code}'
        `);

        let addressSS58: string | undefined;
        for await (const row of results) {
            // @ts-ignore
            addressSS58 = row.data[0];
        }

        client.end().then((info) => console.log("Disconnected from sql-db. Info: " + info)).catch((err) => console.error(err));
        return addressSS58 === undefined ? undefined : '0x' + hexEncode(decodeAddress(addressSS58));
    }

    static async fetchCodesFromAddress(address: string, table: string, ss58format: number, sqlCfg: Configuration): Promise<Array<string> | undefined> {
        const client = new Client(sqlCfg);
        await client.connect();

        if (address === "") {
            return;
        }

        const addressSS58 = encodeAddress(address, ss58format);

        const results = client.query(`
            SELECT referral_code FROM ${table} WHERE wallet_address='${addressSS58}'
        `);

        client.end().then((info) => console.log("Disconnected from sql-db. Info: " + info)).catch((err) => console.error(err));

        let codes: Array<string> = [];
        for await (const row of results) {
            // @ts-ignore
            codes.push(row.data[0]);
        }

        return codes;
    }

    private async generateContributions(): Promise<Map<AccountId, Balance>> {
        const maxContributions = BigInt(1_000_000_000_000_000_000_000_000); // 1_000_000 DAIR. This maxes the amount
        let contributions = BigInt(0);
        let contributors: Map<AccountId, Balance> = new Map();

        const keyringEcdsa = new Keyring({ type: 'ecdsa' });
        const keyringSr25519 = new Keyring({ type: 'sr25519' });
        const keyringEd25519 = new Keyring({ type: 'ed25519' });
        let counter = 0;

        while(contributions <= (BigInt(90) * maxContributions)/BigInt(100)) {
            let amount = ((BigInt(Math.floor(Math.random()*100)) * maxContributions)/BigInt(100_000));
            amount = amount / BigInt(10000000000);
            amount = amount * BigInt(10000000000);

            if(amount + contributions <= maxContributions) {
                contributions += amount;

                counter += 1;
                let type = Math.floor(Math.random()*100);
                let keypair;
                if (0 <= type && type < 100) {
                    keypair = keyringSr25519.addFromUri(`TestAccount${counter}`);
                } else if (40 <= type && type < 80) {
                    keypair = keyringEd25519.addFromUri(`TestAccount${counter}`);
                } else {
                    keypair = keyringEcdsa.addFromUri(`TestAccount${counter}`);
                }
                let account = '0x' + hexEncode(keypair.addressRaw);

                // Fill in storage which we will need to sign stuff later on
                this.syntheticAccounts.set(account, [keypair, amount]);

                // Transform to an actual contribution
                // We do NOT calculate referral or any other rewards here. As this is not part of the testing
                contributors.set(account, amount);
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
            let data = Uint8Array.from(Array.from(hexDecode(account.slice(2))).concat(Array.from(LeU128Bytes(contribution))));

            unsortedHashesAndData.push([
                blake2AsHex(data, 256),
                {account: account, contribution: contribution}
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
                    let data = [left, right].sort((a, b) => {
                        // Sort the hashes alphabetically
                        return ('' + a).localeCompare(b);
                    });
                    let bytes = hexDecode(data[0].slice(2) + data[1].slice(2));

                    levelUp.push(blake2AsHex(bytes, 256));
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

    private async appendContributions(contributions: Map<AccountId, Balance>, filePath: string) {
        try {
            let additionals: Array<Additionals> = [];
            const file = fs.readFileSync(filePath).toString()
            const csv = file.split(/\r?\n/);
            this.logger.debug(csv);

            for (const column of csv) {
                let rows = column.split(',');
                this.logger.debug(rows);

                additionals.push({
                    name: rows[0].trim(),
                    address: rows[1].trim(),
                    amount: BigInt(rows[2].trim()),
                })
            }

            const check = (value: Additionals) => {
                if(value.name === undefined) {
                    throw new Error("Invalid additional contributions parsed. Value is: " + value);
                }
                if(value.address === undefined) {
                    throw new Error("Invalid additional contributions parsed. Value is: " + value);
                }
                if(value.amount === undefined || typeof value.amount !== "bigint") {
                    throw new Error("Invalid additional contributions parsed. Value is: " + value);
                }
            }

            additionals.forEach((contributor) => {
                check(contributor);
                this.logger.info("Contributor Extra:" + JSONbig.stringify(contributor))
                let hexAddress;
                try {
                     hexAddress = `0x${hexEncode(decodeAddress(contributor.address))}`;
                } catch (err) {
                    this.logger.error(`Could not decode address. Contribution of ${contributor.name}  not appended. \n ${err}`);
                    return;
                }

                if (contributions.has(hexAddress)) {
                    const oldAmount = contributions.get(hexAddress);

                    if (oldAmount !== undefined) {
                        contributions.set(hexAddress, oldAmount + contributor.amount);
                        this.logger.info("Adapting contribution from " + hexAddress + " to: " + BigInt(oldAmount + contributor.amount));
                    } else {
                        this.logger.warn("Could not fetch contribution amount from existing account " + hexAddress);
                    }
                } else {
                    contributions.set(hexAddress, contributor.amount);
                    this.logger.info("Setting contribution from " + hexAddress +" manually to: " + contributor.amount);
                }
            })
        } catch (err) {
            return Promise.reject("Failed in appending contributors: \n" + err);
        }
    }

    private async removeContributions(contributions: Map<AccountId, Balance>, filePath: string) {
        try {
            let removals: Array<Removals> = [];
            const file = fs.readFileSync(filePath).toString()
            const csv = file.split(/\r?\n/);
            this.logger.debug(csv);

            const check = (value: Removals) => {
                if(value.name === undefined) {
                    throw new Error("Invalid removal contributions parsed. Value is: " + value);
                }
                if(value.address === undefined) {
                    throw new Error("Invalid removal contributions parsed. Value is: " + value);
                }
            }

            for (const column of csv) {
                let rows = column.split(',');
                this.logger.debug(rows);

                let contributor: Removals = {
                    name: rows[0].trim(),
                    address: rows[1].trim(),
                };

                check(contributor);
                removals.push(contributor)
            }


            removals.forEach((contributor) => {
                this.logger.info("Contributor Removal:" + JSONbig.stringify(contributor))
                let hexAddress;
                try {
                    hexAddress = `0x${hexEncode(decodeAddress(contributor.address))}`;
                } catch (err) {
                    this.logger.error(`Could not decode address. Contribution of ${contributor.name}  not removed. \n ${err}`);
                    return;
                }

                if (contributions.has(hexAddress)) {
                    const oldAmount = contributions.get(hexAddress);

                    if (oldAmount !== undefined) {
                        if (!contributions.delete(hexAddress)) {
                            this.logger.warn("Could not remove contribution from " + hexAddress + " with amount of " + oldAmount + " from merkle-tree.");
                        } else {
                            this.logger.info("Removing contribution from " + hexAddress + " with amount of " + oldAmount + " from merkle-tree.");
                        }
                    } else {
                        this.logger.warn("Could not fetch contribution amount from existing account " + hexAddress);
                    }
                } else {
                    this.logger.warn("Removing contribution from " + hexAddress + " failed. Not in merkle-tree.");
                }
            })
        } catch (err) {
            return Promise.reject("Failed to remove contributors: \n" + err);
        }
    }
}