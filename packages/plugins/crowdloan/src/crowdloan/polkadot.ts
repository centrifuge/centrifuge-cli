import {ApiPromise} from "@polkadot/api";
import {AccountId, Balance, Hash} from "@polkadot/types/interfaces";
import {createDefaultChildStorageKey, fetchChildState, Hasher} from "../../../../libs/sp-state-fetch";
import {fromUtf8ByteArray, LeU32Bytes, toUtf8ByteArray} from "../../../../libs/util";

export async function getContributions(): Promise<void> {

}

async function fetchCrowdloanState(api: ApiPromise, trieIndex: bigint, at: Hash): Promise<Map<AccountId, [Balance, string]>> {
    let crowdloanData = new Map();
    let levels: Array<[string | Uint8Array, Hasher]> = [
    [Uint8Array.from(Array.from(await toUtf8ByteArray("crowdloan")).concat(Array.from(LeU32Bytes(trieIndex)))), Hasher.Blake2_256],
];

const key = await createDefaultChildStorageKey(api, levels);
const contributions = await fetchChildState(api, key, at);

if(contributions.length > 0) {
    crowdloanData.set(trieIndex, new Map());
    let data = crowdloanData.get(trieIndex);

    for (const contr of contributions) {
        //@ts-ignore
        const account = api.createType("AccountId", "0x" + contr[0].toHex().slice(-64));
        //@ts-ignore
        const contributionAndMemo: [Balance, Uint8Array] = api.createType("(Balance, Vec<u8>)", contr[1]);

        crowdloanData.set(account, [contributionAndMemo[0], fromUtf8ByteArray(contributionAndMemo[1])])
    }
}

return crowdloanData
}