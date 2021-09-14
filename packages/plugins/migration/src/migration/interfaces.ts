export interface Credentials {
    pathJSON: string,
    execPwd: string
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

export interface SequenceConfig {
    name: string,
    item: string,
}