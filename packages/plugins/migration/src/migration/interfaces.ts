import {PalletElement, StorageElement, StorageItemElement} from "./common";

export interface Credentials {
    rawSeed: string
}

// All migrations to be executed in the exact order defined in the array.
export type Migrations = Array<Migration>;

// A migration, i.e, a type capturing the migratable item in the source and in the destination chain.
// For example, { source: (RadClaims, AccountBalances), destination: (Claims, ClaimedAmounts) }.
export interface Migration {
    // The source storage item
    source: StorageItem,
    // The destination storage item
    destination: StorageItem
}

// A Pallet Storage item, e.g. `{ pallet: "Balances", item: "TotalIssuance" }`
export interface StorageItem {
    // The name of the pallet
    pallet: string;
    // The name of the storage item
    item: string;
}

export function toStorageElement(x: StorageItem): StorageElement {
    return new StorageItemElement(x.pallet, x.item)
}

export interface MigrationSummary {
    fromFetchedAt: bigint,
    fromStartedAt: bigint,
    toStartedAt: bigint
    toEndAt: bigint,
}