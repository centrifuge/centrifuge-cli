export interface Credentials {
    rawSeed: string
}

export interface Config {
    modules: Array<ModuleConfig>,
    sequence: Array<SequenceConfig>,
}

export interface ModuleConfig {
    // The pallet name
    name: string,
    // The pallet's item name if applicable
    item: StorageItemConfig | undefined,
}

export interface SequenceConfig {
    name: string,
    item: string,
}

// ---------- New stuff

export interface Migration {
    // The items to be migrated, sorted by the order the migration *must* take place.
    items: Array<Item>
}

// A migration item, i.e, a type describing a Migratable from
// the source chain and its destination.
export interface Item {
    source: Migratable,
    destination: Migratable
}

// Union type capturing a migratable item.
export type Migratable = Pallet | PalletStorageItem;

export interface Pallet {
    name: string
}

export interface PalletStorageItem {
    // The pallet this item is under
    pallet: Pallet,
    // the name of the storage item
    name: string
}

export interface StorageItemConfig {
    name: string
}

export interface MigrationStats {
    fromFetchedAt: bigint,
    fromStartedAt: bigint,
    toStartedAt: bigint
    toEndAt: bigint,
    //TODO(nuno): consider delete this field or make it `Migration`
    modules: Array<SequenceConfig>,
}