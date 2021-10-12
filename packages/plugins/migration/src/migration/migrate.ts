import {ApiPromise, SubmittableResult} from "@polkadot/api";
import { xxhashAsHex} from "@polkadot/util-crypto";
import {AccountId, Balance, Hash, VestingInfo} from "@polkadot/types/interfaces";
import {StorageItemElement, PalletElement, StorageElement, StorageItem, StorageValueValue, StorageMapValue} from "../migration/common";
import {ApiTypes, SubmittableExtrinsic} from "@polkadot/api/types";
import {KeyringPair} from "@polkadot/keyring/types";
import {StorageKey} from "@polkadot/types";
import {fork} from "../migration/fork";
import {compactAddLength} from "@polkadot/util"
import {Dispatcher} from "@centrifuge-cli/dispatcher/dist/dispatcher";

export async function verifyMigration(
    toApi: ApiPromise,
    fromApi: ApiPromise,
    storageItems: Array<StorageElement>,
    startTo: Hash,
    atTo: Hash,
    startFrom: Hash,
    atFrom: Hash
): Promise<Array<[StorageKey,  Uint8Array]>> {
    const forkDataOld = await fork(fromApi, storageItems, atFrom);
    const forkDataNew = await fork(toApi, storageItems, atTo);

    const startToAsNum = (await toApi.rpc.chain.getBlock(startTo)).block.header.number.toBigInt();
    const startFromAsNum = (await fromApi.rpc.chain.getBlock(startFrom)).block.header.number.toBigInt();

    let failedVerification= new Array();

    // create a good counter
    let itemsToCheck = 0;
    for (const [_key, data] of Array.from(forkDataOld)) {
        itemsToCheck += data.length;
    }
    console.log("Starting verification of " + itemsToCheck + " migrated storage keys.");

    process.stdout.write("    Verifying:    0/" + itemsToCheck + "\r");
    for (const [key, oldData] of Array.from(forkDataOld)) {

        let newData = forkDataNew.get(key);
        if (newData === undefined){
            failedVerification.push(...oldData);
        } else {
            if (key === xxhashAsHex("System", 128) + xxhashAsHex("Account", 128).slice(2)) {
                let failed = await verifySystemAccount(oldData, fromApi, newData, toApi);
                if(failed.length !== 0) {
                    failedVerification.push(...failed);
                }
            } else if (key === xxhashAsHex("Balances", 128) + xxhashAsHex("TotalIssuance", 128).slice(2)){
                let failed = await verifyBalanceTotalIssuance(oldData, fromApi, newData, toApi, startToAsNum);
                if(failed.length !== 0) {
                    failedVerification.push(...failed);
                }
            } else if (key === xxhashAsHex("Vesting", 128) + xxhashAsHex("Vesting", 128).slice(2)){
                let failed = await verifyVestingVesting(oldData, fromApi, newData, toApi, startFromAsNum, startToAsNum);
                if(failed.length !== 0) {
                    failedVerification.push(...failed);
                }
            } else if (key === xxhashAsHex("Proxy", 128) + xxhashAsHex("Proxies", 128).slice(2)){
                let failed = await verifyProxyProxies(oldData, fromApi, newData, toApi);
                if(failed.length !== 0) {
                    failedVerification.push(...failed);
                }
            } else {
                failedVerification.push(...oldData);
                console.log("Some data from old could not be verified here...");
            }
        }
    }

    return failedVerification;
}

async function verifySystemAccount(
    oldData: Array<[StorageKey, Uint8Array]>,
    oldApi: ApiPromise,
    newData: Array<[StorageKey, Uint8Array]>,
    newApi: ApiPromise
): Promise<Array<[StorageKey, Uint8Array]>> {
    let failed = new Array();

    let newDataMap = newData.reduce(function (map, obj) {
        map.set(obj[0].toHex(), obj[1]);
        return map;
    }, new Map<string, Uint8Array>());

    let checked = 0;
    for(let [key, value] of oldData) {
        process.stdout.write("    Verifying:    "+ checked +"/ \r");

        let oldAccount = oldApi.createType('AccountInfo', value);

        let newScale = newDataMap.get(key.toHex());
        if (newScale !== undefined) {
            let newAccount = newApi.createType('AccountInfo', newScale);

            if (oldAccount.data.free.toBigInt() + oldAccount.data.reserved.toBigInt()
                !== newAccount.data.free.toBigInt() + newAccount.data.reserved.toBigInt())
            {
                let newAccountId = newApi.createType("AccountId", key.toU8a(true).slice(-32));
                let oldAccountId = oldApi.createType("AccountId", key.toU8a(true).slice(-32));
                console.log(
                    "ERROR ACCOUNT: old and new value does not match... \n   Old: "
                    + oldAccount.data.free.toBigInt() + oldAccount.data.reserved.toBigInt()
                    +" vs. New: " +newAccount.data.free.toBigInt() + newAccount.data.reserved.toBigInt()
                    + "\n    for account new " + newAccountId.toHuman() + " account old " + oldAccountId.toHuman()
                );
                failed.push([key, value]);
            }

        } else {
            let oldAccountId = oldApi.createType("AccountId", key.toU8a(true).slice(-32));
            console.log("ERROR ACCOUNT: Could not find responding account on new chain. Lost account is: " + oldAccountId.toHuman());
            failed.push([key, value]);
        }

        checked += 1;
    }

    return failed;
}

async function verifyBalanceTotalIssuance(
    oldData: Array<[StorageKey,  Uint8Array]>,
    oldApi: ApiPromise,
    newData: Array<[StorageKey,  Uint8Array]>,
    newApi: ApiPromise,
    migrationStartBlock: bigint
): Promise<Array<[StorageKey,  Uint8Array]>> {
    let failed = new Array();

    let newDataMap = newData.reduce(function (map, obj) {
        map.set(obj[0].toHex(), obj[1]);
        return map;
    }, new Map<string, Uint8Array>());

    let checked = 0;
    for(let [key, value] of oldData) {
        process.stdout.write("    Verifying:    "+ checked +"/ \r");

        let oldIssuance = oldApi.createType('Balance', value);

        let newScale = newDataMap.get(key.toHex());
        if (newScale !== undefined) {
            let issuanceBeforeMigrationStorage
                = await newApi.rpc.state.getStorage(key.toHex(), await newApi.rpc.chain.getBlockHash(migrationStartBlock));

            //@ts-ignore
            let issuanceBeforeMigration = newApi.createType('Balance', issuanceBeforeMigrationStorage.toU8a(true));
            let newIssuance = newApi.createType('Balance', newScale);

            if (oldIssuance.toBigInt() !== (newIssuance.toBigInt() - issuanceBeforeMigration.toBigInt())) {
                console.log("ERROR ISSUANCE: New total issuance does not match. \n   Old: " + oldIssuance.toHuman() + " vs. New: " + (newIssuance.toHuman()));
                failed.push([key, value]);
            }

        } else {
            console.log("ERROR ISSUANCE: New total issuance not found...");
            failed.push([key, value]);
        }

        checked += 1;
    }

    return failed;
}

async function verifyProxyProxies(
    oldData: Array<[StorageKey,  Uint8Array]>,
    oldApi: ApiPromise,
    newData: Array<[StorageKey,  Uint8Array]>,
    newApi: ApiPromise
): Promise<Array<[StorageKey,  Uint8Array]>> {
    let failed = new Array();

    let newDataMap = newData.reduce(function (map, obj) {
        map.set(obj[0].toHex(), obj[1]);
        return map;
    }, new Map<string, Uint8Array>());

    let checked = 0;
    for(let [key, value] of oldData) {
        process.stdout.write("    Verifying:    "+ checked +"/ \r");

        // @ts-ignore
        let oldProxyInfo = oldApi.createType('(Vec<(AccountId, ProxyType)>, Balance)', value);

        let newScale = newDataMap.get(key.toHex());
        if (newScale !== undefined) {
            // @ts-ignore
            let newProxyInfo = newApi.createType('(Vec<ProxyDefinition<AccountId, ProxyType, BlockNumber>>, Balance)', newScale);

            // Check if same amount of delegatees and same amount of reserved in the system
            // @ts-ignore
            if (oldProxyInfo[0].length === newProxyInfo[0].length
                // @ts-ignore
                && oldProxyInfo[1].toBigInt() === newProxyInfo[1].toBigInt()
            ) {
                // Now also check each delegate of this proxy entry
                // @ts-ignore
                for(const oldDelegate of oldProxyInfo[0]) {
                    let found = false;
                    let oldAccount = oldDelegate[0].toHex();

                    // @ts-ignore
                    for (const newDelegate of newProxyInfo[0]) {
                        let newAccount = newDelegate["delegate"].toHex();
                        let newProxyType = newApi.createType("ProxyType", oldDelegate[1]);
                        if (oldAccount === newAccount &&
                            newDelegate['proxyType'].toHex() === newProxyType.toHex())
                        {
                            found = true;
                        }
                    }

                    if (!found){
                        console.log("ERROR PROXIES: Could not find delegate for migrated proxy. Missing " + oldAccount);
                        failed.push([key, value]);
                    }
                }
            } else {
                let msg = "";
                // @ts-ignore
                for (const newDelegate of newProxyInfo[0]) {
                    msg += newDelegate['delegate'].toHuman() +", "+ newDelegate['proxyType'].toHuman()+ "; ";
                }
                //@ts-ignore
                msg += ", " + newProxyInfo[1].toHuman()
                //@ts-ignore
                console.log("ERROR PROXIES: Migrated ProxyInfo is not correct. Info new: " + msg + "\n vs. info old: " + oldProxyInfo.toHuman());
                failed.push([key, value]);
            }
        } else {
            failed.push([key, value]);
        }

        checked += 1;
    }

    return failed;
}

async function verifyVestingVesting(
    oldData: Array<[StorageKey,  Uint8Array]>,
    oldApi: ApiPromise,
    newData: Array<[StorageKey,  Uint8Array]>,
    newApi: ApiPromise,
    atFrom: bigint,
    atTo: bigint
): Promise<Array<[StorageKey,  Uint8Array]>> {
    let failed = new Array();

    let newDataMap = newData.reduce(function (map, obj) {
        map.set(obj[0].toHex(), obj[1]);
        return map;
    }, new Map<string, Uint8Array>());

    let checked = 0;
    for(let [key, value] of oldData) {
        process.stdout.write("    Verifying:    "+ checked +"/ \r");

        let oldVestingInfo = oldApi.createType('VestingInfo', value);

        const blockPeriodOldVesting = (oldVestingInfo.locked.toBigInt() / oldVestingInfo.perBlock.toBigInt());
        const blocksPassedSinceVestingStart = (atFrom - oldVestingInfo.startingBlock.toBigInt());
        const remainingBlocksVestingOld = blockPeriodOldVesting - blocksPassedSinceVestingStart;

        if (remainingBlocksVestingOld <= 0) {
            // Vesting has passed, the chain will resolve this directly upon our inserts.
        } else {
            let newScale = newDataMap.get(key.toHex());
            if (newScale !== undefined) {
                let newVestingInfo = oldApi.createType('VestingInfo', newScale);

                const blockPeriodNewVesting = newVestingInfo.locked.toBigInt() / newVestingInfo.perBlock.toBigInt();
                const blocksPassedSinceVestingStartNew = (atTo - newVestingInfo.startingBlock.toBigInt());
                const remainingBlocksVestingNew = blockPeriodNewVesting - blocksPassedSinceVestingStartNew;
                const nullOrOne = remainingBlocksVestingOld - (remainingBlocksVestingNew * BigInt(2));

                // Due to the arithmetics we accept if a vesting is off by 2 blocks in each direction.
                if (!(BigInt(-2)  <= nullOrOne &&  nullOrOne <= BigInt(2))) {
                    let newAccount = newApi.createType("AccountId", key.toU8a(true).slice(-32));
                    let oldAccount = oldApi.createType("AccountId", key.toU8a(true).slice(-32));
                    console.log("ERROR: Remaining blocks for vesting are not equal...\n   Old: " +remainingBlocksVestingOld +" vs. New: "+remainingBlocksVestingNew*BigInt(2)+"\n    for account new " + newAccount.toHuman() + " account old " + oldAccount.toHuman());
                     failed.push([key, value]);
                }

            } else {
                let newAccount = newApi.createType("AccountId", key.toU8a(true).slice(-32));
                let oldAccount = oldApi.createType("AccountId", key.toU8a(true).slice(-32));
                console.log("ERROR: Could not find associated VestingInfo on new chain for account new " + newAccount.toHuman() + " account old " + oldAccount.toHuman());
                failed.push([key, value]);
            }
        }

        checked += 1;
    }

    return failed;
}


export async function prepareMigrate(
    transformedData: Map<string, Map<string, Array<StorageItem>>>,
    fromApi: ApiPromise,
    toApi: ApiPromise,
): Promise<Map<string, Map<string, Array<SubmittableExtrinsic<ApiTypes, SubmittableResult>>>>> {
    let migrationXts: Map<string, Map<string, Array<SubmittableExtrinsic<ApiTypes, SubmittableResult>>>> = new Map();

    // For every prefix do the correct transformation.
    for (let [prefix, keyValues] of Array.from(transformedData)) {
        // Match all prefixes we want to transform
        if (prefix.startsWith(xxhashAsHex("System", 128))) {
            let migratedPalletStorageItems = await prepareSystem(toApi, keyValues);
            migrationXts.set(prefix, migratedPalletStorageItems)

        } else if (prefix.startsWith(xxhashAsHex("Balances", 128))) {
            let migratedPalletStorageItems = await prepareBalances(toApi, keyValues);
            migrationXts.set(prefix, migratedPalletStorageItems)

        } else if (prefix.startsWith(xxhashAsHex("Vesting", 128))) {
            let migratedPalletStorageItems = await prepareVesting(toApi, keyValues);
            migrationXts.set(prefix, migratedPalletStorageItems)

        } else if (prefix.startsWith(xxhashAsHex("Proxy", 128))) {
            let migratedPalletStorageItems = await prepareProxy(toApi, keyValues);
            migrationXts.set(prefix, migratedPalletStorageItems)

        } else {
            return Promise.reject("Fetched data that can not be migrated. PatriciaKey is: " + prefix);
        }
    }

    return migrationXts;
}

export async function migrate(
    toApi: ApiPromise,
    executor: KeyringPair,
    sequence: Array<StorageElement>,
    data: Map<string, Map<string, Array<SubmittableExtrinsic<ApiTypes, SubmittableResult>>>>,
    cbErr: (failed: Array<SubmittableExtrinsic<ApiTypes, SubmittableResult>>) => void
) : Promise<Array<[Hash, bigint]>>
{
    const { nonce } = await toApi.query.system.account(executor.address);

    let dispatcher = new Dispatcher(toApi, executor, nonce.toBigInt(), cbErr, 5, 50);

    let dispatchables: Array<Array<SubmittableExtrinsic<ApiTypes, SubmittableResult>>> = new Array();

    for (const one of sequence) {
        if (one instanceof PalletElement) {
            let palletData = data.get(one.palletHash);
            if (palletData !== undefined) {
                for(const [key, data] of Array.from(palletData)) {
                    dispatchables.push(data);
                }
            } else {
                return Promise.reject("Sequence element was NOT part of transformation. Pallet: " + one.pallet);
            }

        } else if (one instanceof StorageItemElement) {
            let storageItemData = data.get(one.palletHash)?.get(one.key)

            if (storageItemData !== undefined) {
                dispatchables.push(storageItemData);
            } else {
                return Promise.reject("Sequence element was NOT part of transformation. Pallet: " + one.pallet + ", Item: " + one.item);
            }
        } else {
            return Promise.reject("Unreachable Code. qed.");
        }
    }

    for (const dispatchable of dispatchables) {
        await dispatcher.sudoDispatch(dispatchable);
    }

    return await dispatcher.getResults();
}


async function prepareSystem(
    toApi: ApiPromise,
    keyValues: Map<string, Array<StorageItem>>
):  Promise<Map<string, Array<SubmittableExtrinsic<ApiTypes, SubmittableResult>>>> {
    let xts: Map<string, Array<SubmittableExtrinsic<ApiTypes, SubmittableResult>>> = new Map();

    // Match against the actual storage items of a pallet.
    for(let [palletStorageItemKey, values] of Array.from(keyValues)) {
        if (palletStorageItemKey === (xxhashAsHex("System", 128) + xxhashAsHex("Account", 128).slice(2))) {
            xts.set(palletStorageItemKey, await prepareSystemAccount(toApi, values));

        } else {
            return Promise.reject("Fetched data that can not be migrated. PatriciaKey is: " + palletStorageItemKey);
        }
    }

    return xts;
}

async function prepareProxy(
    toApi: ApiPromise,
    keyValues: Map<string, Array<StorageItem>>
):  Promise<Map<string, Array<SubmittableExtrinsic<ApiTypes, SubmittableResult>>>> {
    let xts: Map<string, Array<SubmittableExtrinsic<ApiTypes, SubmittableResult>>> = new Map();

    // Match against the actual storage items of a pallet.
    for(let [palletStorageItemKey, values] of Array.from(keyValues)) {
        if (palletStorageItemKey === (xxhashAsHex("Proxy", 128) + xxhashAsHex("Proxies", 128).slice(2))) {
            xts.set(palletStorageItemKey, await prepareProxyProxies(toApi, values));

        } else {
            return Promise.reject("Fetched data that can not be migrated. PatriciaKey is: " + palletStorageItemKey);
        }
    }

    return xts;
}

async function prepareProxyProxies(
    toApi: ApiPromise,
    values: StorageItem[]
): Promise<Array<SubmittableExtrinsic<ApiTypes, SubmittableResult>>> {
    let xts: Array<SubmittableExtrinsic<ApiTypes, SubmittableResult>> = new Array();

    let packetOfProxies: Array<[AccountId, Balance,  Uint8Array]> = new Array();

    // @ts-ignore
    const maxProxies = toApi.consts.migration.migrationMaxProxies.toNumber();

    let counter = 0;
    for (const item of values) {
        // We know from the transformation that optional is set here.
        // In this case it defines the actual amount that shall be reserved on the delegator
        counter += 1;
        if (item instanceof StorageMapValue) {
            if (packetOfProxies.length === maxProxies - 1  || counter === values.length) {
                // push the last element and prepare extrinsic
                let accountId = toApi.createType("AccountId", item.patriciaKey.toU8a(true).slice(-32))
                // @ts-ignore
                let proxyInfo = toApi.createType('(Vec<ProxyDefinition<AccountId, ProxyType, BlockNumber>>, Balance)', item.value);

                //console.log("Inserting Proxy data: " + accountId.toHuman(), item.optional.toHuman(), proxyInfo.toHuman());
                packetOfProxies.push([accountId, item.optional, item.value])

                xts.push(toApi.tx.migration.migrateProxyProxies(packetOfProxies))
                packetOfProxies = new Array();

            } else {
                let accountId = toApi.createType("AccountId", item.patriciaKey.toU8a(true).slice(-32))
                // @ts-ignore
                let proxyInfo = toApi.createType('(Vec<ProxyDefinition<AccountId, ProxyType, BlockNumber>>, Balance)', item.value);
                //console.log("Inserting Proxy data: " + accountId.toHuman(), item.optional.toHuman(), proxyInfo.toHuman());

                packetOfProxies.push([accountId, item.optional, item.value])
            }
        } else {
            return Promise.reject("Expected Proxy.Proxies storage values to be of type StorageMapValue. Got: " + JSON.stringify(item));
        }
    }

    return xts;
}

async function prepareSystemAccount(
    toApi: ApiPromise,
    values: StorageItem[]
): Promise<Array<SubmittableExtrinsic<ApiTypes, SubmittableResult>>> {
    let xts: Array<SubmittableExtrinsic<ApiTypes, SubmittableResult>> = new Array();

    let packetOfAccounts: Array<[ Uint8Array,  Uint8Array]> = new Array();

    // @ts-ignore
    const maxAccounts = toApi.consts.migration.migrationMaxAccounts.toNumber();

    let counter = 0;
    for (const item of values) {
        counter += 1;
        if (item instanceof StorageMapValue) {
            if (packetOfAccounts.length === maxAccounts - 1  || counter === values.length) {
                // push the last element and prepare extrinsic
                packetOfAccounts.push(await retrieveIdAndAccount(item))
                xts.push(toApi.tx.migration.migrateSystemAccount(packetOfAccounts))

                packetOfAccounts = new Array();
            } else {
                packetOfAccounts.push(await retrieveIdAndAccount(item))
            }
        } else {
            return Promise.reject("Expected System.Account storage values to be of type StorageMapValue. Got: " + JSON.stringify(item));
        }
    }

    return xts;
}


async function retrieveIdAndAccount(item: StorageMapValue): Promise<[ Uint8Array,  Uint8Array]> {
    const id = compactAddLength(item.patriciaKey.toU8a(true));
    const value = compactAddLength(item.value);

    return [id, value];
}

async function prepareBalances(
    toApi: ApiPromise,
    keyValues: Map<string, Array<StorageItem>>
):  Promise<Map<string, Array<SubmittableExtrinsic<ApiTypes, SubmittableResult>>>> {
    let xts: Map<string, Array<SubmittableExtrinsic<ApiTypes, SubmittableResult>>> = new Map();

    for(let [palletStorageItemKey, values] of Array.from(keyValues)) {
        if (palletStorageItemKey === xxhashAsHex("Balances", 128) + xxhashAsHex("TotalIssuance", 128).slice(2)) {
            xts.set(palletStorageItemKey, await prepareBalancesTotalIssuance(toApi, values));
        } else {
            return Promise.reject("Fetched data that can not be migrated. PatriciaKey is: " + palletStorageItemKey);
        }
    }

    return xts;
}

async function prepareBalancesTotalIssuance(
    toApi: ApiPromise,
    values: StorageItem[]
): Promise<Array<SubmittableExtrinsic<ApiTypes, SubmittableResult>>> {
    let xts: Array<SubmittableExtrinsic<ApiTypes, SubmittableResult>> = new Array();

    if (values.length != 1) {
        throw Error("TotalIssuance MUST be single value. Got " + values.length);
    }

    for (const item of values) {
        if (item instanceof StorageValueValue) {
            const issuance = toApi.createType("Balance", item.value);

            xts.push(toApi.tx.migration.migrateBalancesIssuance(issuance))
        } else {
            return Promise.reject("Expected Balances.TotalIssuance storage value to be of type StorageValueValue. Got: " + JSON.stringify(item));
        }
    }

    return xts;
}

async function prepareVesting(
    toApi: ApiPromise,
    keyValues: Map<string, Array<StorageItem>>
):  Promise<Map<string, Array<SubmittableExtrinsic<ApiTypes, SubmittableResult>>>> {
    let xts: Map<string, Array<SubmittableExtrinsic<ApiTypes, SubmittableResult>>> = new Map();

    for(let [palletStorageItemKey, values] of Array.from(keyValues)) {
        if (palletStorageItemKey === xxhashAsHex("Vesting", 128) + xxhashAsHex("Vesting", 128).slice(2)) {
            xts.set(palletStorageItemKey, await prepareVestingVestingInfo(toApi, values));

        } else {
            return Promise.reject("Fetched data that can not be migrated. PatriciaKey is: " + palletStorageItemKey);
        }
    }

    return xts;
}

async function prepareVestingVestingInfo(
    toApi: ApiPromise,
    values: StorageItem[]
): Promise<Array<SubmittableExtrinsic<ApiTypes, SubmittableResult>>> {
    let xts: Array<SubmittableExtrinsic<ApiTypes, SubmittableResult>> = new Array();

    let packetOfVestings: Array<[AccountId, VestingInfo]> = new Array();

    // @ts-ignore
    const maxVestings = toApi.consts.migration.migrationMaxVestings.toNumber();
    let counter = 0;

    for (const item of values) {
        counter += 1;
        if (item instanceof StorageMapValue) {
            let vestingInfo = toApi.createType("VestingInfo", item.value);
            let accountId = toApi.createType("AccountId", item.patriciaKey.toU8a(true).slice(-32))

            if (packetOfVestings.length === maxVestings - 1  || counter === values.length){
                // push the last element and prepare extrinsic
                packetOfVestings.push([accountId, vestingInfo])
                xts.push(toApi.tx.migration.migrateVestingVesting(packetOfVestings))

                packetOfVestings = new Array();
            } else {
                packetOfVestings.push([accountId, vestingInfo])
            }
        } else {
            return Promise.reject("Expected Vesting.Vesting storage value to be of type StorageMapValue. Got: " + JSON.stringify(item));
        }
    }

    return xts;
}