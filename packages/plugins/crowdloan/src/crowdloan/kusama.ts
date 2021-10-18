import {ApiPromise} from "@polkadot/api";
import {CrowdloanSpec, KusamaTransformConfig, TransformConfig} from "./interfaces";
import {AccountId, Balance} from "@polkadot/types/interfaces";
import Crowdloan from "../commands/crowdloan";
import {Logger as TsLogger} from 'tslog';
import {BigNumber} from 'bignumber.js'
import {BIT_SIGNED} from "@polkadot/types/extrinsic/constants";
import ownKeys = Reflect.ownKeys;
import {Configuration} from "ts-postgres";
import {encodeAddress} from "@polkadot/keyring";

const axios = require('axios').default;

export async function getContributions(
    paraApi: ApiPromise,
    crowdloans: Array<CrowdloanSpec>,
    config: KusamaTransformConfig,
    logger: TsLogger,
    sqlConfig: Configuration
): Promise<Map<AccountId, Balance>> {
    // Try fetching from web
    let contributors:  Map<string, Array<Contributor>>;

    try {
        contributors = await fetchFromWebService();
    } catch (err) {
        logger.fatal("Could not fetch from webservice. Error: \n" + err);
        return Promise.reject(err);
    }

    return await transformIntoRewardee(paraApi, config, contributors, sqlConfig, logger);
}

async function fetchFromWebService(): Promise<Map<string, Array<Contributor>>> {
    let contributions: Map<string, Array<Contributor>> = new Map();

    try {
      let response = await axios.get('https://crowdloan-ws.centrifuge.io/contributions');

      let overall = BigInt(0);

      if (response !== undefined && response.status === 200 ) {
          for (const noType of response.data) {
              const contributor: Contributor = {
                  account: noType.account,
                  contribution: BigInt(noType.contribution),
                  whenContributed: BigInt(noType.blockNumber),
                  memo: noType.referralCode,
                  first250PrevCrowdloan: JSON.parse(noType.isFirst250PrevCrwdloan),
                  extrinsic: {
                      block: BigInt(noType.extrinsic.blockNumber),
                      index: Number(noType.extrinsic.index)
                  }
              };

              overall += BigInt(noType.contribution);

              contributions.has(noType.account)
                  ? contributions.get(noType.account)?.push(contributor)
                  : contributions.set(noType.account, Array.from([contributor]));
          }

      } else {
          return Promise.reject("Failure fetching data from webservice. Response " + JSON.stringify(response, null, '\t'));
      }
    } catch (err) {
        return Promise.reject(err);
    }

    return contributions;
}

/// This function takes Contributors class and actually generated the reward from this into for a given account
async function transformIntoRewardee(
    api: ApiPromise,
    config: KusamaTransformConfig,
    contributors: Map<string, Array<Contributor>>,
    sqlConfig: Configuration,
    logger: TsLogger
): Promise<Map<AccountId, Balance>> {
    let rewardees: Map<string, bigint> = new Map();

    const codes = await Crowdloan.fetchCodeAddressPairs(sqlConfig);
    for (const [account, contributions] of contributors) {
        let first250Added = false;
        let earlyBirdApplied = false;
        let finalReward = BigInt(0);
        let first250Bonus = BigInt(0);

        for (const contributor of contributions) {
            let contribution = contributor.contribution;

            let ownerOfCode = codes.get(contributor.memo);
            if (ownerOfCode !== undefined) {
                // Give the contributor the stuff he deserves
                const plus = (contributor.contribution * config.referedPrct) / BigInt(100);
                contribution += plus;

                if (rewardees.has(ownerOfCode)) {
                    // @ts-ignore
                    let contributionOwnerOfCode: bigint = rewardees.get(ownerOfCode);
                    rewardees.set(ownerOfCode, contributionOwnerOfCode + plus);
                } else {
                    rewardees.set(ownerOfCode, plus);
                }
            }

            if (contributor.whenContributed <= config.earlyBirdBlock) {
                contribution += (contributor.contribution * config.earlyBirdPrct) / BigInt(100);
                earlyBirdApplied = true;
            }

            // We only add this bonus once
            if (contributor.first250PrevCrowdloan && !first250Added) {
                first250Bonus = ((contributor.contribution * config.prevCrwdLoanPrct) / BigInt(100)) * config.decimalDifference;
                first250Added = true;
            }

             finalReward += config.decimalDifference * contribution;
        }

        if (first250Added && !earlyBirdApplied) {
            finalReward += first250Bonus;
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
        const tAccount = api.createType("AccountId", account);
        const tReward = api.createType("Balance", reward * config.conversionRate);
        typedRewardees.set(tAccount, tReward);
        logger.debug(`Finalizing rewards for account ${encodeAddress(account, 2)} (hex: ${account}) with reward of ${tReward.toHuman()}`)
    }

    return typedRewardees;
}

interface Contributor {
    account: string,
    contribution: bigint,
    memo: string,
    whenContributed: bigint,
    first250PrevCrowdloan: boolean,
    extrinsic: {
        block: bigint,
        index: number,
    }
}

interface Memo {
    account: string,
    memo: string,
    extrinsic: {
        block: bigint,
        index: number
    }
}