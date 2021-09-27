import {AccountId} from "@polkadot/types/interfaces";

export interface Config {
    fundingAccount: string
    // The first one is regarded as the current crowdloan
    // All further specs will be seens as previous loans
    crowdloans: Array<CrowdloanSpec>
    claimPallet: ClaimConfig
    rewardPallet: RewardConfig
    transformation: TransformConfig
}

export interface CrowdloanSpec {
    network: string,
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
    kusama: KusamaTransformConfig
    polkadot: PolkadotTransformConfig
}

export interface PolkadotTransformConfig {

}

export interface KusamaTransformConfig {
    decimalDifference: bigint,
    conversionRate: bigint,
    earlyBirdPrct: bigint,
    earlyBirdBlock: bigint,
    prevCrwdLoanPrct: bigint,
    referedPrct: bigint,
}

export interface Credentials {
    gcloudPrivateKey: string,
    gcloudClientEmail: string,
    executorURI: string
}

export interface MerkleTree {
    rootHash: string,
    tree: Array<Array<string>>
    data: Array<{account: string, contribution: bigint}>
}

export interface Proof {
    leafHash: string,
    sortedHashes: Array<string>,
}