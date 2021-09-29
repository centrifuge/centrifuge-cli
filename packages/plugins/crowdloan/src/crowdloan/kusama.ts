import {ApiPromise} from "@polkadot/api";
import {CrowdloanSpec, KusamaTransformConfig, TransformConfig} from "./interfaces";
import {AccountId, Balance} from "@polkadot/types/interfaces";
import * as Crowdloan from "../commands/crowdloan";
import {Logger as TsLogger} from 'tslog';

const axios = require('axios').default;

export async function getContributions(
    paraApi: ApiPromise,
    crowdloans: Array<CrowdloanSpec>,
    config: KusamaTransformConfig,
    codes: Map<string, AccountId>,
    logger: TsLogger
): Promise<Map<AccountId, Balance>> {
    // Try fetching from web
    let contributors:  Map<AccountId, Array<Contributor>>;

    try {
        contributors = await fetchFromWebService(paraApi);
    } catch (err) {
        logger.fatal("Could not fetch from webservice. Error: \n" + err);
        return Promise.reject(err);
    }

    return await transformIntoRewardee(paraApi, config, codes, contributors);
}

async function fetchFromWebService(api: ApiPromise): Promise<Map<AccountId, Array<Contributor>>> {
    let contributions: Map<AccountId, Array<Contributor>> = new Map();

    try {
      let response = await axios.get('http://localhost:6464/contributions');

      if (response !== undefined && response.status === 200 ) {
          for (const noType of response.data) {
              let account = noType.account;
              const contributor: Contributor = {
                  account: noType.account,
                  contribution: BigInt(noType.contribution),
                  whenContributed: BigInt(noType.blockNumber),
                  memo: noType.referralCode,
                  first250PrevCrowdloan: BigInt(noType.amountFirst250PrevCrwdloan),
                  extrinsic: {
                      block: BigInt(noType.extrinsic.blockNumber),
                      index: Number(noType.extrinsic.index)
                  }
              };

              contributions.has(account)
                  ? contributions.get(account)?.push(contributor)
                  : contributions.set(account, Array.from([contributor]));
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
    codesToAccount: Map<string, AccountId>,
    contributors: Map<AccountId, Array<Contributor>>
): Promise<Map<AccountId, Balance>> {
    let rewardees: Map<AccountId, Balance> = new Map();

    for (const [account, contributions] of contributors) {
        let first250Added = false;
        let earlyBirdApplied = false;
        let finalReward = BigInt(0);
        let first250Bonus = BigInt(0);

        for (const contributor of contributions) {
            let contribution = contributor.contribution;

            if (codesToAccount.has(contributor.memo)) {
                // Give the contributor the stuff he deserves
                const plus = (contributor.contribution * config.referedPrct) / BigInt(100);
                contribution += plus;

                // Give the owner of the referral code the same amount
                // @ts-ignore
                let ownerOfCode: AccountId = codesToAccount.get(contributor.memo);
                if (rewardees.has(ownerOfCode)) {
                    // @ts-ignore
                    let contributionOwnerOfCode: Balance = rewardees.get(ownerOfCode);
                    rewardees.set(ownerOfCode, api.createType("Balance", contributionOwnerOfCode.toBigInt() + plus));
                } else {
                    rewardees.set(ownerOfCode, api.createType("Balance", plus));
                }
            }

            if (contributor.whenContributed <= config.earlyBirdBlock) {
                contribution += (contributor.contribution * config.earlyBirdPrct) / BigInt(100);
                earlyBirdApplied = true;
            }

            // We only add this bonus once
            if (contributor.first250PrevCrowdloan !== BigInt(0) && !first250Added) {
                first250Bonus = (contributor.contribution * config.prevCrwdLoanPrct) / BigInt(100);
                first250Added = true;
            }

             finalReward += config.decimalDifference * contribution;
        }

        if (finalReward && !earlyBirdApplied) {
            finalReward += first250Bonus;
        }

        if (rewardees.has(account)){
            // @ts-ignore
            let alreadyContribution: Balance = rewardees.get(account);
            rewardees.set(account, api.createType("Balance", alreadyContribution.toBigInt() + finalReward));
        } else {
            rewardees.set(account, api.createType("Balance", finalReward));
        }
    }

    return rewardees;
}

interface Contributor {
    account: string,
    contribution: bigint,
    memo: string,
    whenContributed: bigint,
    first250PrevCrowdloan: bigint,
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