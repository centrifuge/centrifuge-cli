import '@polkadot/api-augment/substrate';
import { ApiPromise } from "@polkadot/api";
import { StorageKey } from "@polkadot/types";
import { xxhashAsHex, blake2AsHex } from "@polkadot/util-crypto";
import { Hash } from "@polkadot/types/interfaces";
import { hexEncode } from "@centrifuge-cli/util";

export enum Hasher {
    None,
    Twox64,
    Twox64Concat,
    Twox128,
    Twox256,
    Blake2_128,
    Blake2_128Concat,
    Blake2_256
}

export async function createDefaultChildStorageKey(api: ApiPromise, levels: Array<[Uint8Array | string, Hasher]>): Promise<StorageKey> {
    let key = "0x" + await hexEncode(":child_storage:default:");

    for (const level of levels) {
        key = key.concat(await hash(level[0], level[1]));
    }

    return api.createType("StorageKey", key);
}

export async function createStorageKey(api: ApiPromise, levels: Array<[string | Uint8Array, Hasher]>): Promise<StorageKey> {
    let key = "0x";

    for (const level of levels) {
        key = key.concat(await hash(level[0], level[1]));
    }

    return api.createType("StorageKey", key);
}

async function hash(input: string | Uint8Array, hasher: Hasher): Promise<string> {
    if (hasher === Hasher.None) {
        return await hexEncode(input);
    } else if (hasher === Hasher.Twox64) {
        return xxhashAsHex(input, 64).slice(2);
    } else if (hasher === Hasher.Twox64Concat) {
        return xxhashAsHex(input, 64).slice(2) + await hexEncode(input);
    } else if (hasher === Hasher.Twox128) {
        return xxhashAsHex(input, 128).slice(2);
    } else if (hasher === Hasher.Twox256) {
        return xxhashAsHex(input, 256).slice(2);
    } else if (hasher === Hasher.Blake2_128) {
        return blake2AsHex(input, 128).slice(2);
    } else if (hasher === Hasher.Blake2_128Concat) {
        return blake2AsHex(input, 128).slice(2) + await hexEncode(input);
    } else if (hasher === Hasher.Blake2_256) {
        return blake2AsHex(input, 256).slice(2);
    } else {
        return Promise.reject("Unreachable code");
    }
}

export async function fetchState(api: ApiPromise, key: StorageKey, at?: Hash): Promise<Array<[StorageKey, Uint8Array]>> {
    // The substrate api does provide the actual prefix, as the next_key, as we do here, when next key
    // is not available. In order to use the at option, we do this here upfront.
    try {
        // TODO: Check if Startkey should be = "" or = key
        let keyArray = await api.rpc.state.getKeysPaged(key, 1000, "", at);

        // getKeysPaged does not work for StorageValues, lets try if it is one
        if (keyArray === undefined || keyArray.length === 0) {
            let value = await api.rpc.state.getStorage(key, at);

            if (value !== undefined) {
                // @ts-ignore
                let valueArray = value.toU8a(true);

                if (valueArray.length > 0) {
                    return [[key, valueArray]];
                } else {
                    return [];
                }
            }
        }

        let fetched = false;
        while (!fetched) {
            let intermArray = await api.rpc.state.getKeysPaged(key, 1000, keyArray[keyArray.length - 1], at);
            if (intermArray.length === 0) {
                fetched = true;
            } else {
                keyArray.push(...intermArray);
            }
        }


        let pairs: Array<[StorageKey, Uint8Array]> = [];
        for (const storageKey of keyArray) {
            let storageValue = await api.rpc.state.getStorage(storageKey, at);
            // @ts-ignore // We are using the "bare" option here, as StorageData is typically wrapped in an Option<>
            let storageArray = storageValue.toU8a(true);

            if (storageArray !== undefined && storageArray.length > 0) {
                pairs.push([storageKey, storageArray]);
            } else {
            }
        }

        return pairs;
    } catch (err) {
        return Promise.reject(err);
    }
}

/// TODO: Explain about childstorage
///
export async function fetchChildState(
    api: ApiPromise,
    keyToChildRoot: StorageKey,
    at?: Hash,
    prefixOfSearch?: StorageKey,
    startKey?: StorageKey
): Promise<Array<[StorageKey, Uint8Array]>> {
    // The substrate api does provide the actual prefix, as the next_key, as we do here, when next key
    // is not available. In order to use the at option, we do this here upfront.
    try {
        let keyArray = await api.rpc.childstate.getKeysPaged(keyToChildRoot, prefixOfSearch, 1000, startKey, at);

        // getKeysPaged does not work for StorageValues, lets try if it is one
        if (keyArray === undefined || keyArray.length === 0) {
            let value = await api.rpc.childstate.getStorage(keyToChildRoot, startKey, at);

            if (value.isSome) {
                // @ts-ignore
                let valueArray = value.unwrap().toU8a(true);

                if (valueArray.length > 0) {
                    return [[keyToChildRoot, valueArray]];
                } else {
                    return [];
                }
            } else {
                return [];
            }
        }

        let fetched = false;
        while (!fetched) {
            let intermArray = await api.rpc.childstate.getKeysPaged(keyToChildRoot, prefixOfSearch, 1000, keyArray[keyArray.length - 1], at);
            if (intermArray.length === 0) {
                fetched = true;
            } else {
                keyArray.push(...intermArray);
            }
        }


        let pairs: Array<[StorageKey, Uint8Array]> = [];
        for (const storageKey of keyArray) {
            let storageValue = await api.rpc.childstate.getStorage(keyToChildRoot, storageKey, at);

            if (storageValue.isSome) {
                // @ts-ignore // We are using the "bare" option here, to strip all Options<>, etc.
                let storageArray = storageValue.unwrap().toU8a(true);

                if (storageArray !== undefined && storageArray.length > 0) {
                    pairs.push([storageKey, storageArray]);
                }
            }
        }

        return pairs;
    } catch (err) {
        return Promise.reject(err);
    }
}
