import {PalletElement, StorageElement, StorageItemElement} from "./common";

export interface Credentials {
    rawSeed: string
}

// All migrations to be executed in the exact order defined in the array.
export type Migrations = Array<Migration>;

// A migration, i.e, a type capturing the migratable item in the source and in the destination chain.
// For example, { source: (RadClaims, AccountBalances), destination: (Claims, ClaimedAmounts) }.
export interface Migration {
    // The migratable info on the source chain
    source: Migratable,
    // The migratable info on the destination chain
    destination: Migratable
}

// Union type capturing a migratable item.
export type Migratable = Pallet | PalletStorageItem;

export interface Pallet {
    type: MigratableType.Pallet;
    name: string;
}

// A Pallet Storage item, e.g. `{ pallet: "Balances", name: "TotalIssuance" }`
export interface PalletStorageItem {
    type: MigratableType.PalletStorageItem;
    // The pallet this item is under
    pallet: string;
    // The name of the storage item
    name: string;
}

// The different Migratable variant types
export enum MigratableType {
    Pallet = "Pallet",
    PalletStorageItem = "PalletStorageItem",
}

export function toStorageElement(m: Migratable): StorageElement {
    switch (m.type) {
        case MigratableType.Pallet:
            return new PalletElement(m.name);
        case MigratableType.PalletStorageItem:
            return new StorageItemElement(m.pallet, m.name);
    }
}

export interface MigrationSummary {
    fromFetchedAt: bigint,
    fromStartedAt: bigint,
    toStartedAt: bigint
    toEndAt: bigint,
}