import {AccountId} from "@polkadot/types/interfaces";

export interface Config {
    // The first one is regarded as the current crowdloan
    // All further specs will be seens as previous loans
    crowdloans: Array<CrowdloanSpec>
    claimPallet: ClaimConfig
    rewardPallet: RewardConfig
    transformation: TransformConfig
}

export interface CrowdloanSpec {
    paraId: bigint
    trieIndex: bigint
    createBlock: bigint
    endBlock: bigint
}

export interface ClaimConfig {
    locketAt: bigint,
    index: bigint,
    leaseStart: bigint,
    leasePeriod: bigint,
}

export interface RewardConfig {
    directPayoutRatio: bigint,
    vestingStart: bigint,
    vestingPeriod: bigint,
}

export interface TransformConfig {
    decimalDifference: bigint,
    conversionRate: bigint,
    earlyBirdPrct: bigint,
    earlyBirdBlock: bigint,
    earlyHourPrct: bigint,
    referralUsedPrct: bigint,
    referedPrct: bigint,
}

export interface Contributor {
    account: string, // A string, encoding account id as hex (0x...)
    contribution: bigint, // Probably a BigInt
    codes: Array<string>, // This will be empy and must be fetched by the UI from the bucket
    referred: boolean,
    earlyHour: boolean, // True if contributed in PREVIOUS crowdloan
    whenContributed: bigint, // Probably a BigInt
    referrals: Array<AccountId>
}

export interface Credentials {
    gcloudPrivateKey: string,
    gcloudClientEmail: string,
    execPwd: string
}

export interface MerkleTree {
    rootHash: string,
    tree: Array<Array<string>>
    data: Array<{account: string, contribution: bigint}>
}