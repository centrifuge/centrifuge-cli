export interface Credentials {
    rawSeed: string
}

export interface Config {
    modules: Array<ModuleConfig>,
    sequence: Array<SequenceConfig>,
}

export interface ModuleConfig {
    name: string,
    item: StorageItemConfig | undefined,
}

export interface StorageItemConfig {
    name: string
}

export interface MigrationStats {
    fromFetchedAt: bigint,
    fromStartedAt: bigint,
    toStartedAt: bigint
    toEndAt: bigint,
    modules: Array<SequenceConfig>,
}

export interface SequenceConfig {
    name: string,
    item: string,
}