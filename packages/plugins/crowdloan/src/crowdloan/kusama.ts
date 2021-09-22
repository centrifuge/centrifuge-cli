import {ApiPromise} from "@polkadot/api";
import {CrowdloanSpec, KusamaTransformConfig, TransformConfig} from "./interfaces";
import {AccountId, Balance} from "@polkadot/types/interfaces";
import * as Crowdloan from "../commands/crowdloan";

export async function getContributions(
    paraApi: ApiPromise,
    crowdloans: Array<CrowdloanSpec>,
    config: KusamaTransformConfig,
    codes: Map<string, AccountId>
): Promise<Map<AccountId, Balance>> {

    // Fetch previous 250 from kusama, generate prevCorwdloan as result

    // Fetch all events and also failed like in script
    // Create Contributor structs from this

    //return await transformIntoRewardee(paraApi, config, codes, contributors);
    return new Map();
}

/// This function takes Contributors class and actually generated the reward from this into for a given account
async function transformIntoRewardee(
    api: ApiPromise,
    config: KusamaTransformConfig,
    codesToAccount: Map<string, AccountId>,
    prevCrowdloan: Map<AccountId, Balance>,
    contributors: Map<AccountId, Array<Contributor>>
): Promise<Map<AccountId, Balance>> {
    let rewardees: Map<AccountId, Balance> = new Map();

    for (const [account, contributions] of contributors) {
        for (const contributor of contributions) {
            let contribution = contributor.contribution;

            if (codesToAccount.has(contributor.memo)) {
                // Give the contributor the stuff he deserves
                const plus = (contribution * config.referedPrct) / BigInt(100);
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

            if (prevCrowdloan.has(account)) {
                //@ts-ignore // We check above in if
                contribution += (prevCrowdloan.get(account).toBigInt() * config.earlyHourPrct) / BigInt(100);
            }

            if (contributor.whenContributed <= config.earlyBirdBlock) {
                contribution += (contribution * config.earlyBirdPrct) / BigInt(100);
            }

            let afterConversion = config.decimalDifference * contribution;

            if (rewardees.has(account)){
                // @ts-ignore
                let alreadyContribution: Balance = rewardees.get(account);
                rewardees.set(account, api.createType("Balance", alreadyContribution.toBigInt() + afterConversion));
            } else {
                rewardees.set(account, api.createType("Balance", afterConversion));
            }
        }
    }

    return rewardees;
}

interface Contributor {
    account: string,
    contribution: bigint,
    memo: string,
    whenContributed: bigint,
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