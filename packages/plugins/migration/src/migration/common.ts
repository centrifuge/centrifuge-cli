import {xxhashAsHex} from "@polkadot/util-crypto";
import {StorageKey} from "@polkadot/types";


export async function insertOrNewMap(map: Map<string, Array<any>>, key: string, item: any) {
    if (map.has(key)) {
        let itemsArray = map.get(key);
        // @ts-ignore // We check that above
        itemsArray.push(item);
    } else {
        let itemsArray: Array<StorageItem> = new Array();
        itemsArray.push(item);
        map.set(key, itemsArray);
    }
}

export async function toHexString(byteArray: Uint8Array | number[]): Promise<string> {
    let hex: Array<string> = [];
    let asArray = Array.from(byteArray);

    for (let byte of asArray) {
        let val =  ('0' + (byte & 0xFF).toString(16)).slice(-2);
        hex.push(val)
    }

    return hex.join('')
}

export async function toByteArray(hexString: string): Promise<Uint8Array> {
    if (hexString.length % 2 !== 0) {
        throw "Must have an even number of hex digits to convert to bytes";
    }

    const numBytes = hexString.length / 2;
    let byteArray = new Uint8Array(numBytes);

    for (let i = 0; i < numBytes; i++) {
        byteArray[i] = parseInt(hexString.substr(i*2, 2), 16);
    }

    return byteArray;
}

export abstract class StorageElement {
    readonly key: string

    protected constructor(key: string) {
        this.key = key;
    }
}

export class PalletElement extends StorageElement{
    readonly pallet: string
    readonly palletHash: string

    constructor(pallet: string) {
        let key = xxhashAsHex(pallet, 128);
        super(key);
        this.pallet = pallet;
        this.palletHash = xxhashAsHex(pallet, 128);
    }
}

export class StorageItemElement extends StorageElement {
    readonly pallet: string
    readonly palletHash: string
    readonly item: string
    readonly itemHash: string

    constructor(pallet: string, item: string) {
        let key = xxhashAsHex(pallet, 128) + xxhashAsHex(item, 128).slice(2);
        super(key);
        this.pallet = pallet;
        this.palletHash = xxhashAsHex(pallet, 128);
        this.item = item;
        this.itemHash = xxhashAsHex(item, 128);
    }
}



export abstract class StorageItem {
    value: Uint8Array;

    constructor(value: Uint8Array) {
        this.value = value;
    }
}

export class StorageValueValue extends StorageItem {
    constructor(value: Uint8Array) {
        super(value);
    }
}

export class StorageMapValue extends StorageItem {
    patriciaKey: StorageKey;
    // Intentionally allow arbitrary data here. The user MUST now what will be used here
    optional: any;

    constructor(value: Uint8Array, key: StorageKey, optional?: any) {
        super(value);

        this.optional = optional;
        this.patriciaKey = key;
    }

}

export class StorageDoubleMapValue extends StorageItem {
    patriciaKey1: StorageKey;
    patriciaKey2: StorageKey;

    constructor(value: Uint8Array, key1: StorageKey, key2: StorageKey) {
        super(value);

        this.patriciaKey1 = key1;
        this.patriciaKey2 = key2;
    }
}
