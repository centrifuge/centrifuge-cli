import {ApiPromise} from "@polkadot/api";
import { xxhashAsHex } from "@polkadot/util-crypto";
import {AccountInfo, Balance, Hash, ProxyDefinition} from "@polkadot/types/interfaces";
import {insertOrNewArray, StorageItem, StorageValueValue, StorageMapValue, getOrInsertMap} from "../migration/common";
import {StorageKey} from "@polkadot/types";
import {compactAddLength} from "@polkadot/util";

// Transform the source state to match the appropriate schema in the destination
export async function transform(
    forkData: Map<string, Array<[ StorageKey, Uint8Array]>>,
    fromApi: ApiPromise,
    toApi: ApiPromise,
    startFrom: Hash,
    atFrom: Hash,
    atTo: Hash
): Promise<Map<string, Map<string, Array<StorageItem>>>>   {
    let state: Map<string, Map<string, Array<StorageItem>>> = new Map();

    // For every prefix do the correct transformation.
    for (let [key, keyValues] of forkData) {
        // Match all prefixes we want to transform
        if (key.startsWith(xxhashAsHex("System",128))) {
             let palletKey = xxhashAsHex("System", 128);
             let palletItems = getOrInsertMap(state, palletKey);
             await transformSystem(fromApi, toApi, palletItems, keyValues);

        } else if (key.startsWith(xxhashAsHex("Balances", 128))) {
            let palletKey = xxhashAsHex("Balances", 128);
            let palletItems = getOrInsertMap(state, palletKey);
            await transformBalances(fromApi, toApi, palletItems, keyValues);

        } else if (key.startsWith(xxhashAsHex("Vesting", 128))) {
            let palletKey = xxhashAsHex("Vesting", 128);
            let palletItems = getOrInsertMap(state, palletKey);
            await transformVesting(fromApi, toApi, palletItems, keyValues, startFrom, atTo);

        } else if (key.startsWith(xxhashAsHex("Proxy", 128))) {
            let palletKey = xxhashAsHex("Proxy", 128);
            let palletItems = getOrInsertMap(state, palletKey);
            await transformProxy(fromApi, toApi, palletItems, keyValues);

        } else if (key.startsWith(xxhashAsHex("RadClaims", 128))) {
            let palletKey = xxhashAsHex("Claims", 128);
            let palletItems = getOrInsertMap(state, palletKey);
            await transformClaims(fromApi, toApi, palletItems, keyValues);

        } else {
            return Promise.reject("Fetched data that can not be transformed. PatriciaKey is: " + key);
        }
    }

    return state;
}

async function transformClaims (fromApi: ApiPromise, toApi: ApiPromise, state: Map<string, Array<StorageItem>>, keyValues: Array<[StorageKey, Uint8Array]>) {
    for(let [patriciaKey, value] of keyValues) {
        if (patriciaKey.toHex().startsWith(xxhashAsHex("RadClaims", 128) + xxhashAsHex("AccountBalances", 128).slice(2))) {
            let pkStorageItem = xxhashAsHex("Claims", 128) + xxhashAsHex("ClaimedAmounts", 128).slice(2);
            await insertOrNewArray(state, pkStorageItem, await transformClaimsClaimedAmounts(fromApi, toApi, patriciaKey, value));

        } else if (patriciaKey.toHex().startsWith(xxhashAsHex("RadClaims", 128) + xxhashAsHex("RootHashes", 128).slice(2))) {
            let pkStorageItem = xxhashAsHex("Claims", 128) + xxhashAsHex("RootHashes", 128).slice(2);
            await insertOrNewArray(state, pkStorageItem, await transformClaimsRootHashes(fromApi, toApi, patriciaKey, value));

        } else if (patriciaKey.toHex().startsWith(xxhashAsHex("RadClaims", 128) + xxhashAsHex("UploadAccount", 128).slice(2))) {
            let pkStorageItem = xxhashAsHex("Claims", 128) + xxhashAsHex("UploadAccount", 128).slice(2);
            await insertOrNewArray(state, pkStorageItem, await transformClaimsUploadAccount(fromApi, toApi, patriciaKey, value));

        } else {
            return Promise.reject("Fetched data that can not be transformed. PatriciaKey is: " + patriciaKey.toHuman());
        }
    }
}

async function transformClaimsClaimedAmounts(fromApi: ApiPromise, toApi: ApiPromise, completeKey: StorageKey, scaleClaimedAmountsUser:  Uint8Array): Promise<StorageItem> {
    // We need to update the pallet and the item hash prefixes of the key here
    let newPrefix = xxhashAsHex("Claims", 128) + xxhashAsHex("ClaimedAmounts", 128).slice(2);
    // First 64 characters plus 0x from hex representation
    let keyWithoutPrefix = completeKey.toHex().slice(66);
    let newKey = toApi.createType("StorageKey", newPrefix + keyWithoutPrefix);
    return new StorageMapValue(scaleClaimedAmountsUser, newKey);

}

async function transformClaimsRootHashes(fromApi: ApiPromise, toApi: ApiPromise, completeKey: StorageKey, scaleRootHashBool:  Uint8Array): Promise<StorageItem> {
    // We need to update the pallet and the item hash prefixes of the key here
    let newPrefix = xxhashAsHex("Claims", 128) + xxhashAsHex("RootHashes", 128).slice(2);
    // First 64 characters plus 0x from hex representation
    let keyWithoutPrefix = completeKey.toHex().slice(66);
    let newKey = toApi.createType("StorageKey", newPrefix + keyWithoutPrefix);
    return new StorageMapValue(scaleRootHashBool, newKey);

}

async function transformClaimsUploadAccount(fromApi: ApiPromise, toApi: ApiPromise, completeKey: StorageKey, scaleUploadAccount:  Uint8Array): Promise<StorageItem> {
    // We don't need to update the patricia key here as we will generate the correct one in the migration during
    // creation of the set_storage extrinsic
    return new StorageValueValue(scaleUploadAccount);
}

async function transformProxy(
    fromApi: ApiPromise,
    toApi: ApiPromise,
    state: Map<string, Array<StorageItem>>,
    keyValues: Array<[StorageKey, Uint8Array]>
) {

    // Match against the actual storage items of a pallet.
    for(let [patriciaKey, value] of keyValues) {
        if (patriciaKey.toHex().startsWith(xxhashAsHex("Proxy", 128) + xxhashAsHex("Proxies", 128).slice(2))) {
            let pkStorageItem = xxhashAsHex("Proxy", 128) + xxhashAsHex("Proxies", 128).slice(2);
            await insertOrNewArray(state, pkStorageItem, await transformProxyProxies(fromApi, toApi, patriciaKey, value));
        } else {
            return Promise.reject("Fetched data that can not be transformed. PatriciaKey is: " + patriciaKey.toHuman());
        }
    }
}

async function transformProxyProxies(fromApi: ApiPromise, toApi: ApiPromise, completeKey: StorageKey, scaleOldProxies:  Uint8Array): Promise<StorageItem> {
    // @ts-ignore, see https://github.com/polkadot-js/api/issues/3746
    let oldProxyInfo = fromApi.createType('(Vec<(AccountId, ProxyType)>, Balance)', scaleOldProxies);

    let proxies: Array<ProxyDefinition> = new Array();

    // For the checks if anonymous proxies, we check if CINC is part of the proxies. Which indicates, that
    // that it is indeed an anonymous proxy. As CINC itself is a multisig...
    const CINC =  fromApi.createType("AccountId", "4djGpfJtHkS3kXBNtSFijf8xHbBY8mYvnUR7zrLM9bCyF7Js");
    let CINCisDelegate = false;

    // 1. Iterate over all elements of the vector
    // 2. Create a `ProxyDefinition` for each element
    // @ts-ignore // Not sure, how we can define an actual type here. Think this has no interface on the polkadot-api side
    for (const oldElement of oldProxyInfo[0]) {
        let delegate = toApi.createType("AccountId", oldElement[0]);
        if (CINC.toHex() === delegate.toHex()) {
            CINCisDelegate = true;
        }

        let proxyType = toApi.createType("ProxyType", oldElement[1]);

        let delay = toApi.createType("BlockNumber", 0);

        let proxyDef = toApi.createType("ProxyDefinition",
            [
                delegate,
                proxyType,
                delay
            ]);

        proxies.push(proxyDef);
    }

    // @ts-ignore // Not sure, how we can define an actual type here. Think this has no interface on the polkadot-api side
    let deposit = toApi.createType("Balance", oldProxyInfo[1]);

    // @ts-ignore, see https://github.com/polkadot-js/api/issues/3746
    let newProxyInfo = toApi.createType('(Vec<ProxyDefinition<AccountId, ProxyType, BlockNumber>>, Balance)',
    [
                proxies,
                deposit
        ]
    );

    // We must somehow detect the anonymous proxies. This can only be done on a best effort basis.
    // The reason for this is, that when an anonymous proxy did some actions, that included the reserve of
    // his balances, the logic below will not detect it, if the reserve goes above the threshold. There is no other
    // way to detect an anonymous proxy otherwise...
    const proxiedAccount = fromApi.createType("AccountId", completeKey.slice(-32));
    const { nonce, data: balance } = await fromApi.query.system.account(proxiedAccount);
    const base = await fromApi.consts.proxy.proxyDepositBase;
    const perProxy = await fromApi.consts.proxy.proxyDepositFactor;

    let reserve: Balance;
    // In the case that we see that the amount reserved is smaller than 350 mCFG, we can be sure, that this
    // is an anonymous proxy. The reverse does not prove the non-existence of an anonymous proxy!
    // Hence, we must ensure, that we subtract 350 mCFg from the deposit, as this one is reserved on the creator!
    if (balance.reserved.toBigInt() < (BigInt(proxies.length) * perProxy.toBigInt()) + base.toBigInt()) {
        let amount = deposit.toBigInt() - (perProxy.toBigInt() + base.toBigInt());
        reserve = toApi.createType("Balance", amount);
    } else if (CINCisDelegate) {
        let amount = deposit.toBigInt() - (perProxy.toBigInt() + base.toBigInt());
        reserve = toApi.createType("Balance", amount);
    } else {
        reserve = toApi.createType("Balance", deposit);
    }

    return new StorageMapValue(newProxyInfo.toU8a(), completeKey, reserve);
}


async function transformSystem(
    fromApi: ApiPromise,
    toApi: ApiPromise,
    state: Map<string, Array<StorageItem>>,
    keyValues: Array<[StorageKey, Uint8Array ]>
) {
    // Match against the actual storage items of a pallet.
    for(let [patriciaKey, value] of keyValues) {
        let systemAccount = xxhashAsHex("System", 128) + xxhashAsHex("Account", 128).slice(2);
        if (patriciaKey.toHex().startsWith(systemAccount)) {
            let pkStorageItem = xxhashAsHex("System", 128) + xxhashAsHex("Account", 128).slice(2);
            await insertOrNewArray(state, pkStorageItem, await transformSystemAccount(fromApi, toApi, patriciaKey, value));
        } else {
            return Promise.reject("Fetched data that can not be transformed. PatriciaKey is: " + patriciaKey.toHuman());
        }
    }
}

async function transformSystemAccount(fromApi: ApiPromise, toApi: ApiPromise, completeKey: StorageKey, scaleOldAccountInfo:  Uint8Array): Promise<StorageItem> {
    let oldAccountInfo = fromApi.createType("AccountInfo", scaleOldAccountInfo);

    let newAccountInfo = await toApi.createType("AccountInfo", [
        0, // nonce
        0, // consumers
        1, // provider
        0, // sufficients
        [
            oldAccountInfo.data.free.toBigInt() + oldAccountInfo.data.reserved.toBigInt(), // free balance
            0, // reserved balance
            0, // misc frozen balance
            0  // free frozen balance
        ]
    ]);

    if (oldAccountInfo.data.free.toBigInt() + oldAccountInfo.data.reserved.toBigInt()  !== newAccountInfo.data.free.toBigInt()) {
        let old = oldAccountInfo.data.free.toBigInt() + oldAccountInfo.data.reserved.toBigInt();
        return Promise.reject("Transformation failed. AccountData Balances. (Left: " + old + " vs. " + "Right: " + newAccountInfo.data.free.toBigInt());
    }

    return new StorageMapValue(newAccountInfo.toU8a(true), completeKey);
}

async function transformBalances(
    fromApi: ApiPromise,
    toApi: ApiPromise,
    state: Map<string, Array<StorageItem>>,
    keyValues: Array<[StorageKey,  Uint8Array]>
) {
    for(let [patriciaKey, value] of keyValues) {
        if (patriciaKey.toHex().startsWith(xxhashAsHex("Balances", 128) + xxhashAsHex("TotalIssuance", 128).slice(2))) {
            let pkStorageItem = xxhashAsHex("Balances", 128) + xxhashAsHex("TotalIssuance", 128).slice(2);
            await insertOrNewArray(state, pkStorageItem, await transformBalancesTotalIssuance(fromApi, toApi, patriciaKey, value));
        } else {
            return Promise.reject("Fetched data that can not be transformed. Part of Balances. PatriciaKey is: " + patriciaKey.toHex());
        }
    }
}

async function transformBalancesTotalIssuance(fromApi: ApiPromise, toApi: ApiPromise, completeKey: StorageKey, scaleOldTotalIssuance:  Uint8Array): Promise<StorageItem> {
    let oldIssuance = fromApi.createType("Balance", scaleOldTotalIssuance);
    let newIssuance = toApi.createType("Balance", oldIssuance.toU8a(true));

    if (oldIssuance.toBigInt() !== newIssuance.toBigInt()) {
        return Promise.reject("Transformation failed. TotalIssuance. (Left: " + oldIssuance.toJSON() + " vs. " + "Right: " + newIssuance.toJSON());
    }

    return new StorageValueValue(newIssuance.toU8a(true));
}

async function transformVesting(
    fromApi: ApiPromise,
    toApi: ApiPromise,
    state: Map<string, Array<StorageItem>>,
    keyValues: Array<[StorageKey,  Uint8Array]>,
    atFrom: Hash,
    atTo: Hash
) {
    const atToAsNumber = (await toApi.rpc.chain.getBlock(atTo)).block.header.number.toBigInt();
    const atFromAsNumber =  (await fromApi.rpc.chain.getBlock(atFrom)).block.header.number.toBigInt();


    for(let [patriciaKey, value] of keyValues) {
        if (patriciaKey.toHex().startsWith(xxhashAsHex("Vesting", 128) + xxhashAsHex("Vesting", 128).slice(2))) {
            let pkStorageItem = xxhashAsHex("Vesting", 128) + xxhashAsHex("Vesting", 128).slice(2);
            await insertOrNewArray(state, pkStorageItem, await transformVestingVestingInfo(fromApi, toApi, patriciaKey, value, atFromAsNumber, atToAsNumber));

        } else {
            return Promise.reject("Fetched data that can not be transformed. PatriciaKey is: " + patriciaKey.toHuman());
        }
    }
}

async function transformVestingVestingInfo(fromApi: ApiPromise, toApi: ApiPromise, completeKey: StorageKey, scaleOldVestingInfo:  Uint8Array, atFrom: bigint, atTo: bigint): Promise<StorageItem> {
    let old = fromApi.createType("VestingInfo", scaleOldVestingInfo);

    let remainingLocked;
    let newPerBlock;
    let newStartingBlock;

    const blockPeriodOldVesting = (old.locked.toBigInt() / old.perBlock.toBigInt());
    const blocksPassedSinceVestingStart = (atFrom - old.startingBlock.toBigInt());

    // We need to check if vesting is ongoing, is finished or has not yet started, as conversion will be different.
    if (blocksPassedSinceVestingStart > 0 && (blockPeriodOldVesting - blocksPassedSinceVestingStart) > 0) {
        // This defines the remaining blocks one must wait until his
        // vesting is over.
        //
        // Details:
        // * (locked/per_block): Number blocks on mainnet overall
        // * snapshot_block - starting_block: Number of vested blocks
        // * subtraction of the above two: How many blocks remain
        let remainingBlocks = (blockPeriodOldVesting - blocksPassedSinceVestingStart);
        // This defines the remaining locked amount. Same as if a person has called vest once at the snapshot block.
        remainingLocked = old.locked.toBigInt() - (blocksPassedSinceVestingStart * old.perBlock.toBigInt());
        // Ensure remaining locked is greater zero
        if (remainingLocked === BigInt(0)) {
            remainingLocked = BigInt(1);
        }
        // * Multiplication by two: Take into account 12s block time
        newPerBlock = (remainingLocked / remainingBlocks) * BigInt(2);
        // Ensure remaining locked is greater zero
        // If we are here, this must be checked manually...
        if (newPerBlock === BigInt(0)) {
            const info = toApi.createType("VestingInfo", [remainingLocked, newPerBlock, atTo]);
            throw Error("Invalid vesting schedule. \nStorageKey: " + completeKey.toHex() + "\n VestingInfo: " + info.toHuman());
        }
        newStartingBlock = atTo;

    } else if ((blockPeriodOldVesting - blocksPassedSinceVestingStart) <= 0 ) {
        // If vesting is finished -> use same start block and give everything at first block
        remainingLocked = old.locked.toBigInt();
        newPerBlock = old.locked.toBigInt();
        newStartingBlock = atTo;

    } else if ((old.startingBlock.toBigInt() - atFrom) >= 0){
        // If vesting has not started yes -> use starting block as (old - blocks_passed_on_old_mainnet) / 2 and multiply per block by 2 to take into account
        // 12s block time.
        remainingLocked = old.locked.toBigInt();
        newPerBlock = old.perBlock.toBigInt() * BigInt(2);
        newStartingBlock = ((old.startingBlock.toBigInt() - atFrom) / BigInt(2)) + atTo;

    } else {
        throw Error("Unreachable code... Came here with old vesting info of: " + old.toHuman());
    }

    let newVesting = await toApi.createType("VestingInfo", [remainingLocked, newPerBlock, newStartingBlock]);

    return new StorageMapValue(newVesting.toU8a(true), completeKey);
}
