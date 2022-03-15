import {ApiPromise} from "@polkadot/api";
import {CrowdloanSpec, PolkadotTransformConfig, AccountId, Balance} from "./interfaces";
import Crowdloan from "../commands/crowdloan";
import {Logger as TsLogger} from 'tslog';
import {BigNumber} from 'bignumber.js'
import {BIT_SIGNED} from "@polkadot/types/extrinsic/constants";
import ownKeys = Reflect.ownKeys;
import {Configuration} from "ts-postgres";
import {encodeAddress} from "@polkadot/keyring";
import {Logger} from "@centrifuge-cli/core/dist/logger";

const axios = require('axios').default;

export async function getContributions(
    paraApi: ApiPromise,
    crowdloans: Array<CrowdloanSpec>,
    config: PolkadotTransformConfig,
    logger: TsLogger,
    sqlConfig: Configuration
): Promise<Map<AccountId, Balance>> {
    // Try fetching from web
    let contributors:  Map<string, Array<Contributor>>;

    try {
        contributors = await fetchFromWebService(logger);
    } catch (err) {
        logger.fatal("Could not fetch from webservice. Error: \n" + err);
        return Promise.reject(err);
    }

    return await transformIntoRewardee(paraApi, config, contributors, sqlConfig, logger);
}

async function fetchFromWebService(log: TsLogger): Promise<Map<AccountId, Array<Contributor>>> {
    let contributions: Map<AccountId, Array<Contributor>> = new Map();

    try {
        let response = await axios({
            url: "https://app.gc.subsquid.io/beta/centrifuge-sqd5/v2/graphql",
            method: "post",
            headers: { "Content-Type": "application/json" },
            data: {
                query: `
                  query AllContributions {
                     contributions(limit: 1000000) {
                      id
                      earlyBird
                      balance
                      prevContributed
                      referralCode
                      blockNumber
                    }
                  }
                `,
            },
        });

        let overall = BigInt(0);
        if (response !== undefined && response.status === 200 ) {
            for (const noType of response.data.data.contributions) {

                if (invalidNoType(noType)) {
                    log.warn("Fetched contribution is invalid: " + JSON.stringify(noType))
                    continue
                }

                let account = getAccount(noType.id, log);
                const contributor: Contributor = {
                    account: account,
                    contribution: BigInt(noType.balance),
                    whenContributed: BigInt(noType.blockNumber),
                    memo: noType.referralCode === null ? "" : noType.referralCode,
                    earlyBird: noType.earlyBird,
                    prevContributed: noType.prevContributed,
                };

                overall += BigInt(noType.balance);

                contributions.has(account)
                    ? contributions.get(account)?.push(contributor)
                    : contributions.set(account, Array.from([contributor]));
            }

        log.info("Overall contributions: " + overall);
        } else {
            return Promise.reject("Failure fetching data from webservice. Response " + JSON.stringify(response, null, '\t'));
        }
    } catch (err) {
        return Promise.reject(err);
    }


    return contributions;
}

function invalidNoType(noType: any): boolean {
    return noType.id === null
    || noType.balance === null
    || noType.blockNumber === null
    || noType.earlyBird === null
    || noType.prevContributed === null;
}

function getAccount(id: string, log: TsLogger): string {
    let split = id.split("-")
    try {
        let address = split[0];
        // Testing of valid address just to be sure
        let _encoded = encodeAddress(address, 0)
        return address
    } catch (err) {
        throw new Error("Failed decoding address fetched from webservice. Id: " + split + "\n" + err)
    }
}

/// This function takes Contributors class and actually generated the reward from this into for a given account
async function transformIntoRewardee(
    api: ApiPromise,
    config: PolkadotTransformConfig,
    contributors: Map<string, Array<Contributor>>,
    sqlConfig: Configuration,
    logger: TsLogger
): Promise<Map<AccountId, Balance>> {
    let rewardees: Map<string, bigint> = new Map();

    const codes = await Crowdloan.fetchCodeAddressPairs('centrifuge', sqlConfig);
    for (const [account, contributions] of contributors) {
        let finalReward = BigInt(0);
        let contributionSumInDot = BigInt(0);
        let contributionSumInCfg = BigInt(0);

        for (const contributor of contributions) {
            contributionSumInDot += contributor.contribution;
            let contributionAsCfg = (contributor.contribution * config.decimalDifference * config.conversionRate) / BigInt(1000000000);
            contributionSumInCfg += contributionAsCfg;
            finalReward += contributionAsCfg;

            let ownerOfCode = codes.get(contributor.memo);
            if (ownerOfCode !== undefined && contributors.has(ownerOfCode)) {
                // Give the contributor the stuff he deserves
                const referralReward = (contributionAsCfg * config.referedPrct) / BigInt(100);
                finalReward += referralReward;

                if (rewardees.has(ownerOfCode)) {
                    // @ts-ignore
                    let contributionOwnerOfCode: bigint = rewardees.get(ownerOfCode);
                    rewardees.set(ownerOfCode, contributionOwnerOfCode + referralReward);
                } else {
                    rewardees.set(ownerOfCode, referralReward);
                }
            }

            if (contributor.earlyBird) {
                finalReward += (contributionAsCfg * config.earlyBirdPrct) / BigInt(100);
            }

            // We only add this bonus once
            if (contributor.prevContributed) {
                finalReward += (contributionAsCfg * config.prevCrwdLoanPrct) / BigInt(100);
            }
        }

        // 50_000_000_000_000 = 5000 DOT
        let heavyWeightInDot = BigInt(50_000_000_000_000);
        if (contributionSumInDot >= heavyWeightInDot) {
            finalReward += (contributionSumInCfg * config.heavyWeight) / BigInt(100);
        }

        if (rewardees.has(account)){
            // @ts-ignore
            let alreadyContribution: bigint = rewardees.get(account);
            rewardees.set(account, alreadyContribution + finalReward);
        } else {
            rewardees.set(account, finalReward);
        }
    }

    let typedRewardees = new Map();
    // Need to create AccountId types here
    for(const [account, reward] of rewardees) {
        typedRewardees.set(account, reward);
        logger.debug(`Finalizing rewards for account ${encodeAddress(account, 0)} (hex: ${account}) with reward of ${reward}`)
    }

    return typedRewardees;
}

interface Contributor {
    account: string,
    contribution: bigint,
    memo: string,
    whenContributed: bigint,
    earlyBird: boolean,
    prevContributed: boolean,
}

interface Memo {
    account: string,
    memo: string,
    extrinsic: {
        block: bigint,
        index: number
    }
}