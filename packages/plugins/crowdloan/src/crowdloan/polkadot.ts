import {AccountId, Balance} from "./interfaces";

export async function getContributions(): Promise<Map<AccountId, Balance>> {
    return Promise.reject("Polkadot contributions generation not yet implemented!");
}