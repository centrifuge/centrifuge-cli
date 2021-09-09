export function LeU8Bytes(input: number | bigint): Uint8Array {
    let num = Number(input);
    return new Uint8Array([
        (num & 0xff),
    ]);
}

export function LeU16Bytes(input: number | bigint): Uint8Array {
    let num = Number(input);
    return new Uint8Array([
        (num & 0x00ff),
        (num & 0xff00) >> 8,
    ]);
}

export function LeU32Bytes(input: number | bigint): Uint8Array {
    let num = Number(input);
    return new Uint8Array([
        (num & 0x000000ff),
        (num & 0x0000ff00) >> 8,
        (num & 0x00ff0000) >> 16,
        (num & 0xff000000) >> 24,
    ]);
}

export function LeU64Bytes(num: bigint): Uint8Array {
    return new Uint8Array([
        Number((num & BigInt(0x00000000000000ff))),
        Number((num & BigInt(0x000000000000ff00)) >> BigInt(8)),
        Number((num & BigInt(0x0000000000ff0000)) >> BigInt(16)),
        Number((num & BigInt(0x00000000ff000000)) >> BigInt(24)),
        Number((num & BigInt(0x000000ff00000000)) >> BigInt(32)),
        Number((num & BigInt(0x0000ff0000000000)) >> BigInt(40)),
        Number((num & BigInt(0x00ff000000000000)) >> BigInt(48)),
        Number((num & BigInt(0xff00000000000000)) >> BigInt(56)),
    ]);
}

export function LeU128Bytes(num: bigint): Uint8Array {
    return new Uint8Array([
        Number((num & BigInt(0x000000000000000000000000000000ff))),
        Number((num & BigInt(0x0000000000000000000000000000ff00)) >> BigInt(8)),
        Number((num & BigInt(0x00000000000000000000000000ff0000)) >> BigInt(16)),
        Number((num & BigInt(0x000000000000000000000000ff000000)) >> BigInt(24)),
        Number((num & BigInt(0x0000000000000000000000ff00000000)) >> BigInt(32)),
        Number((num & BigInt(0x00000000000000000000ff0000000000)) >> BigInt(40)),
        Number((num & BigInt(0x000000000000000000ff000000000000)) >> BigInt(48)),
        Number((num & BigInt(0x0000000000000000ff00000000000000)) >> BigInt(56)),
        Number((num & BigInt(0x00000000000000ff0000000000000000)) >> BigInt(64)),
        Number((num & BigInt(0x000000000000ff000000000000000000)) >> BigInt(72)),
        Number((num & BigInt(0x0000000000ff00000000000000000000)) >> BigInt(80)),
        Number((num & BigInt(0x00000000ff0000000000000000000000)) >> BigInt(88)),
        Number((num & BigInt(0x000000ff000000000000000000000000)) >> BigInt(96)),
        Number((num & BigInt(0x0000ff00000000000000000000000000)) >> BigInt(104)),
        Number((num & BigInt(0x00ff0000000000000000000000000000)) >> BigInt(112)),
        Number((num & BigInt(0xff000000000000000000000000000000)) >> BigInt(120)),
    ]);
}

export function BeU8Bytes(input: number | bigint): Uint8Array {
    let num = Number(input);
    return new Uint8Array([
        (num & 0xff),
    ]);
}

export function BeU16Bytes(input: number | bigint): Uint8Array {
    let num = Number(input);
    return new Uint8Array([
        (num & 0xff00) >> 8,
        (num & 0x00ff),
    ]);
}

export function BeU32Bytes(input: number | bigint): Uint8Array {
    let num = Number(input);
    return new Uint8Array([
        (num & 0xff000000) >> 24,
        (num & 0x00ff0000) >> 16,
        (num & 0x0000ff00) >> 8,
        (num & 0x000000ff),
    ]);
}

export function BeU64Bytes(num: bigint): Uint8Array {
    return new Uint8Array([
        Number((num & BigInt(0xff00000000000000)) >> BigInt(56)),
        Number((num & BigInt(0x00ff000000000000)) >> BigInt(48)),
        Number((num & BigInt(0x0000ff0000000000)) >> BigInt(40)),
        Number((num & BigInt(0x000000ff00000000)) >> BigInt(32)),
        Number((num & BigInt(0x00000000ff000000)) >> BigInt(24)),
        Number((num & BigInt(0x0000000000ff0000)) >> BigInt(16)),
        Number((num & BigInt(0x000000000000ff00)) >> BigInt(8)),
        Number((num & BigInt(0x00000000000000ff))),
    ]);
}

export function BeU128Bytes(num: bigint): Uint8Array {
    return new Uint8Array([
        Number((num & BigInt(0xff000000000000000000000000000000)) >> BigInt(120)),
        Number((num & BigInt(0x00ff0000000000000000000000000000)) >> BigInt(112)),
        Number((num & BigInt(0x0000ff00000000000000000000000000)) >> BigInt(104)),
        Number((num & BigInt(0x000000ff000000000000000000000000)) >> BigInt(96)),
        Number((num & BigInt(0x00000000ff0000000000000000000000)) >> BigInt(88)),
        Number((num & BigInt(0x0000000000ff00000000000000000000)) >> BigInt(80)),
        Number((num & BigInt(0x000000000000ff000000000000000000)) >> BigInt(72)),
        Number((num & BigInt(0x00000000000000ff0000000000000000)) >> BigInt(64)),
        Number((num & BigInt(0x0000000000000000ff00000000000000)) >> BigInt(56)),
        Number((num & BigInt(0x000000000000000000ff000000000000)) >> BigInt(48)),
        Number((num & BigInt(0x00000000000000000000ff0000000000)) >> BigInt(40)),
        Number((num & BigInt(0x0000000000000000000000ff00000000)) >> BigInt(32)),
        Number((num & BigInt(0x000000000000000000000000ff000000)) >> BigInt(24)),
        Number((num & BigInt(0x00000000000000000000000000ff0000)) >> BigInt(16)),
        Number((num & BigInt(0x0000000000000000000000000000ff00)) >> BigInt(8)),
        Number((num & BigInt(0x000000000000000000000000000000ff))),
    ]);
}