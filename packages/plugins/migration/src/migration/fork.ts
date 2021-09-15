import {ApiPromise} from "@polkadot/api";
import {StorageKey} from "@polkadot/types";
import {Hash } from "@polkadot/types/interfaces";

import { StorageElement} from "../migration/common";

export async function fork(api: ApiPromise, storageItems: Array<StorageElement>, at: Hash): Promise<Map<string, Array<[ StorageKey, Uint8Array ]>>>   {
    let state: Map<string, Array<[ StorageKey, Uint8Array ]>> = new Map();

    for (const element of storageItems) {
        let data = await fetchState(api, at, api.createType("StorageKey", element.key));

        state.set(element.key, data);
    }

    return state;
}

async function fetchState(api: ApiPromise, at: Hash, key: StorageKey): Promise<Array<[ StorageKey, Uint8Array ]>> {
    console.log("Fetching storage for prefix: " + key.toHuman());

    // The substrate api does provide the actual prefix, as the next_key, as we do here, when next key
    // is not available. In order to use the at option, we do this here upfront.
    let keyArray = await api.rpc.state.getKeysPaged(key, 1000, key, at);

    // getKeysPaged does not work for StorageValues, lets try if it is one
    if (keyArray === undefined || keyArray.length === 0) {
        console.log("Fetched keys: 1");
        let value = await api.rpc.state.getStorage(key, at);

        if (value !== undefined) {
            // @ts-ignore
            let valueArray = value.toU8a(true);
            console.log("Fetched storage values: 1/1");

            if (valueArray.length > 0) {
                return [[key, valueArray]];
            } else {
                console.log("ERROR: Fetched empty storage value for key " + key.toHex() + "\n");
                return [];
            }
        }
    }

    let fetched = false;
    let accumulate = keyArray.length;

    while (!fetched) {
        let nextStartKey = api.createType("StorageKey", keyArray[keyArray.length - 1]);
        let intermArray = await api.rpc.state.getKeysPaged(key, 1000, nextStartKey, at);

        accumulate = accumulate + intermArray.length;
        process.stdout.write("Fetched keys: " + accumulate + "\r");

        if (intermArray.length === 0) {
            fetched = true;
        } else {
            keyArray.push(...intermArray);
        }
    }

    process.stdout.write("\n");

    let pairs: Array<[StorageKey, Uint8Array ]> = [];

    accumulate = 0;
    let promises = new Array();
    for (const storageKey of keyArray) {
        let clos = (async () => {
            let storageValue = await api.rpc.state.getStorage(storageKey, at);
            // @ts-ignore
            let storageArray = storageValue.toU8a(true);

            if (storageArray !== undefined && storageArray.length > 0) {
                pairs.push([storageKey, storageArray]);
            } else {
                console.log("ERROR: Fetched empty storage value for key " + storageKey.toHex() + "\n");
            }

            accumulate = accumulate + 1;
            process.stdout.write("Fetched storage values: " + accumulate + "/" + keyArray.length + "\r");
        })
        promises.push(clos());
    }

    await Promise.all(promises);

    process.stdout.write("\n");

    return pairs;
}