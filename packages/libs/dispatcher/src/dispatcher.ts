import {ApiTypes, SubmittableExtrinsic} from "@polkadot/api/types";
import {xxhashAsHex} from "@polkadot/util-crypto";
import {ApiPromise, Keyring, SubmittableResult, WsProvider} from "@polkadot/api";
import {KeyringPair} from "@polkadot/keyring/types";
import {Hash} from "@polkadot/types/interfaces";
import '@polkadot/api-augment'

export class Dispatcher {
    readonly maxConcurrent: number;
    readonly perBlock: number;
    readonly cbErr: (xts: Array<SubmittableExtrinsic<ApiTypes, SubmittableResult>>) => void;
    readonly signer: KeyringPair;
    private running: number;
    private dispatched: bigint;
    private api: ApiPromise;
    private nonce: bigint;
    private dispatchHashes: Array<[Hash, bigint]>;

    constructor(api: ApiPromise, keypair: KeyringPair, startingNonce: bigint, cbErr?: (xts: Array<SubmittableExtrinsic<ApiTypes, SubmittableResult>>) => void, perBlock: number = 100, concurrent: number = 500) {
        if (cbErr !== undefined) {
            this.cbErr = cbErr;
        } else {
            this.cbErr = (xts: Array<SubmittableExtrinsic<ApiTypes, SubmittableResult>>) => {
            };
        }

        this.api = api;
        this.nonce = startingNonce;
        this.maxConcurrent = concurrent;
        this.running = 0;
        this.perBlock = perBlock;
        this.signer = keypair;
        this.dispatched = BigInt(0);
        this.dispatchHashes = new Array();
    }

    async nextNonce(): Promise<bigint>{
        let tmp = this.nonce;
        this.nonce = tmp + BigInt(1);
        return tmp;
    }

    async returnNonce(activeNonce: bigint): Promise<boolean> {
        if(this.nonce === activeNonce + BigInt(1)) {
            this.nonce = activeNonce;
            return true;
        } else {
            return Promise.reject("Nonce has already progressed. Account out of sync with dispatcher. Need to abort or inject xt with nonce: " + activeNonce + " in order to progress.");
        }
    }

    async dryRun(xts: Array<SubmittableExtrinsic<ApiTypes, SubmittableResult>>): Promise<boolean> {
        for(const xt of xts) {
            // TODO: Currently no check is possible, as the nodes seem not to suply this rpc method...
            /*
            // @ts-ignore
            let result = await this.api.rpc.system.dryRun(xt.toHex()).catch(err => {
                console.log(err);
            });

            // @ts-ignore
            if (result.isErr()){
                return false;
            }
            */
        }
        console.log("No checks performed, due to unavailability of `dry_run()` on chain.");
        return true;
    }


    async dispatch(xts: Array<SubmittableExtrinsic<ApiTypes, SubmittableResult>>, inSequence: boolean = false) {
        if (!await this.dryRun(xts)) {
            this.cbErr(xts)
            return;
        }

        if (inSequence) {
            await this.dispatchInternalInSequence(xts);
        } else {
            await this.dispatchInternal(xts);
        }

    }

    private async dispatchInternal(xts: Array<SubmittableExtrinsic<ApiTypes, SubmittableResult>>) {
        let counter = 0;
        for (const extrinsic of xts) {
            counter += 1;

            if (counter % this.perBlock === 0) {
                await new Promise(r => setTimeout(r, 6000));
            }

            while (this.running >= this.maxConcurrent) {
                await new Promise(r => setTimeout(r, 6000));
            }
            this.dispatched += BigInt(1);
            this.running += 1;

            const send = async () => {
                let activeNonce = await this.nextNonce();
                const unsub = await extrinsic.signAndSend(this.signer, {nonce: activeNonce}, ({ events = [], status}) => {
                    if (status.isInBlock) {
                        events.forEach(({event: {data, method, section}, phase}) => {
                            if (method === 'ExtrinsicSuccess') {
                                this.dispatchHashes.push([status.asInBlock, phase.asApplyExtrinsic.toBigInt()]);
                            } else if (method === 'ExtrinsicFailed') {
                                this.dispatchHashes.push([status.asInBlock, phase.asApplyExtrinsic.toBigInt()])
                                this.cbErr([extrinsic])
                            }

                            this.running -= 1;
                        });
                    } else if (status.isFinalized) {
                        // @ts-ignore
                        unsub();
                    }
                    // @ts-ignore
                }).catch(async (err) => {
                    this.running -= 1;
                    this.dispatched -= BigInt(1);
                    this.cbErr(xts);
                    await this.returnNonce(activeNonce).catch((err) => console.log(err));
                    console.log(err)
                });
            }

            await send().catch((err) => console.log(err));
        }
    }

    async getResults() : Promise<Array<[Hash, bigint]>> {
        while (BigInt(this.dispatchHashes.length) !== this.dispatched && this.running !== 0) {
            process.stdout.write("Waiting for results. Returned calls " + this.dispatchHashes.length + " vs. dispatched " + this.dispatched + ". Running: " + this.running + " \r");
            await new Promise(r => setTimeout(r, 6000));
        }

        return this.dispatchHashes
    }


    private async dispatchInternalInSequence(xts: Array<SubmittableExtrinsic<ApiTypes, SubmittableResult>>) {
        let xt = xts.shift();

        if (xt === undefined) {
            return Promise.resolve();
        }

        let callNext = async () => {
            let extrinsic = xts.shift();

            if (extrinsic === undefined) {
                return Promise.resolve();
            } else {
                while (this.running >= this.maxConcurrent) {
                    await new Promise(r => setTimeout(r, 6000));
                }

                this.dispatched += BigInt(1);
                this.running += 1;

                const send = async () => {
                    let activeNonce = await this.nextNonce();
                    //@ts-ignore // We are checking if xt is undefined after shift
                    const unsub = await extrinsic.signAndSend(this.signer, {nonce: activeNonce}, ({
                                                                                                      events = [],
                                                                                                      status
                                                                                                  }) => {
                        if (status.isInBlock) {
                            events.forEach(({event: {data, method, section}, phase}) => {
                                if (method === 'ExtrinsicSuccess') {
                                    this.dispatchHashes.push([status.asInBlock, phase.asApplyExtrinsic.toBigInt()]);
                                    callNext();
                                } else if (method === 'ExtrinsicFailed') {
                                    this.dispatchHashes.push([status.asInBlock, phase.asApplyExtrinsic.toBigInt()])
                                    //@ts-ignore // We are checking if xt is undefined after shift
                                    this.cbErr([extrinsic])
                                }

                                this.running -= 1;
                            });
                        } else if (status.isFinalized) {
                            // @ts-ignore
                            unsub();
                        }
                        // @ts-ignore
                    }).catch(async (err) => {
                        this.running -= 1;
                        this.dispatched -= BigInt(1);
                        this.cbErr(xts);
                        await this.returnNonce(activeNonce).catch((err) => console.log(err));
                        console.log(err)
                    });

                    await send().catch((err) => console.log(err));
                }
            }
        }

        while (this.running >= this.maxConcurrent) {
            await new Promise(r => setTimeout(r, 6000));
        }
        this.dispatched += BigInt(1);
        this.running += 1;

        const send = async () => {
            let activeNonce = await this.nextNonce();
            // @ts-ignore // We are checking if xt is undefined after shift
            const unsub = await xt.signAndSend(this.signer, {nonce: activeNonce}, ({events = [], status}) => {
                if (status.isInBlock) {
                    events.forEach(({event: {data, method, section}, phase}) => {
                        if (method === 'ExtrinsicSuccess') {
                            this.dispatchHashes.push([status.asInBlock, phase.asApplyExtrinsic.toBigInt()]);
                            callNext();
                        } else if (method === 'ExtrinsicFailed') {
                            this.dispatchHashes.push([status.asInBlock, phase.asApplyExtrinsic.toBigInt()])
                            // @ts-ignore // We are checking if xt is undefined after shift
                            this.cbErr([xt])
                        }

                        this.running -= 1;
                    });
                } else if (status.isFinalized) {
                    // @ts-ignore
                    unsub();
                }
                // @ts-ignore
            }).catch(async (err) => {
                this.running -= 1;
                this.dispatched -= BigInt(1);
                this.cbErr(xts);
                await this.returnNonce(activeNonce).catch((err) => console.log(err));
                console.log(err)
            });
        }

        await send().catch((err) => console.log(err));
    }


    async sudoDispatch(xts: Array<SubmittableExtrinsic<ApiTypes, SubmittableResult>>) {
        if (!await this.dryRun(xts)) {
            this.cbErr(xts)
        }

        let counter = 0;
        for (const extrinsic of xts) {
            counter += 1;

            if (counter % this.perBlock === 0) {
                await new Promise(r => setTimeout(r, 6000));
                console.log("Waiting in perBlock... " + counter)
            }

            while (this.running >= this.maxConcurrent) {
                await new Promise(r => setTimeout(r, 6000));
                console.log("Waiting in line... " + counter)
            }
            this.dispatched += BigInt(1);
            this.running += 1;
            console.log("Sending with nonce " + this.nonce + ", running " + this.running +" : " + extrinsic.meta.name.toString());

            const send = async () => {
                let activeNonce = await this.nextNonce();
                const unsub = await this.api.tx.sudo.sudo(extrinsic)
                    .signAndSend(this.signer, {nonce: activeNonce}, ({events = [], status}) => {
                        if (status.isInBlock || status.isFinalized) {
                            console.log("Sending with nonce " + activeNonce + " is in Block/Finalized : " + extrinsic.meta.name.toString());
                            events.filter(({event}) =>
                                this.api.events.sudo.Sudid.is(event)
                            )
                                .forEach(({event: {data: [result]}, phase}) => {
                                    // We know that `Sudid` returns just a `Result`
                                    // @ts-ignore
                                    if (result.isError) {
                                        this.dispatchHashes.push([status.asInBlock, phase.asApplyExtrinsic.toBigInt()]);
                                        this.cbErr([extrinsic])
                                        console.log("Sudo error: " + activeNonce);
                                    } else {
                                        this.dispatchHashes.push([status.asInBlock, phase.asApplyExtrinsic.toBigInt()]);
                                        console.log("Sudo ok: " + activeNonce);
                                    }
                                });

                            this.running -= 1;
                            // @ts-ignore
                            unsub();
                        }
                    }).catch(async (err) => {
                        this.running -= 1;
                        this.dispatched -= BigInt(1);
                        this.cbErr([extrinsic]);
                        await this.returnNonce(activeNonce).catch((err) => console.log(err));
                        console.log(err)
                    });
            }

            await send().catch((err) => console.log(err));
        }
    }

    async batchDispatch(xts: Array<SubmittableExtrinsic<ApiTypes, SubmittableResult>>) {
        if (!await this.dryRun(xts)) {
            this.cbErr(xts)
        }

        while (this.running >= this.maxConcurrent) {
            await new Promise(r => setTimeout(r, 6000));
        }
        this.dispatched += BigInt(1);
        this.running += 1;

        const send = async () => {
            let activeNonce = await this.nextNonce();
            const unsub = await this.api.tx.utility
                .batch(xts)
                .signAndSend(this.signer, {nonce: activeNonce}, ({status, events}) => {
                    if (status.isInBlock) {
                        events.forEach(({event: {data, method, section}, phase}) => {
                            if (method === 'ExtrinsicSuccess') {
                                this.dispatchHashes.push([status.asInBlock, phase.asApplyExtrinsic.toBigInt()]);
                            } else if (method === 'ExtrinsicFailed') {
                                this.dispatchHashes.push([status.asInBlock, phase.asApplyExtrinsic.toBigInt()]);
                                this.cbErr(xts);
                            }
                        });

                        this.running -= 1;
                    } else if (status.isFinalized) {
                        // @ts-ignore
                        unsub();
                    }
                }).catch(async (err) => {
                    this.running -= 1;
                    this.dispatched -= BigInt(1);
                    this.cbErr(xts);
                    await this.returnNonce(activeNonce).catch((err) => console.log(err));
                    console.log(err)
                });
        }

        await send().catch((err) => console.log(err));
    }

}


export abstract class StorageElement {
    readonly key: string

    constructor(key: string) {
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

export async function test_run () {
    const wsProvider = new WsProvider("wss://fullnode-archive.centrifuge.io");
    const api = await ApiPromise.create({
        provider: wsProvider,
        types: {
            ProxyType: {
                _enum: ['Any', 'NonTransfer', 'Governance', 'Staking', 'Vesting']
            }
        }
    });

    const keyring = new Keyring({type: 'sr25519'});
    let alice = keyring.addFromUri('//Alice');
    let failed: Array<SubmittableExtrinsic<ApiTypes, SubmittableResult>> = new Array();

    const { nonce } = await api.query.system.account(alice.address);

    const cbErr = (xts: Array<SubmittableExtrinsic<ApiTypes, SubmittableResult>>) => {
        for(const xt of xts) {
            console.log(xt.toHuman());
        }
    }

    let dispatcher = new Dispatcher(api, alice, nonce.toBigInt(), cbErr, 10, 100);

    for (let i = 0; i < 100; i++) {
        let send = async function sending(){
            const nonce = await dispatcher.nextNonce();

            await sendingInternal(dispatcher, i, nonce)
                .catch(async (err) => {
                    console.log(err);
                    await dispatcher.returnNonce(nonce).catch((err) => {console.log(err)});
                });
        };

        await send();
    }

    api.disconnect();
}

async function sendingInternal(dispatcher: Dispatcher, anynumber: number, nonce: bigint): Promise<bigint>{
    if (anynumber % 2 === 0) {
        console.log("Run: " + anynumber + ", nonce: " + nonce);
    } else {
        return Promise.reject("Uneven call...");
    }

    return BigInt(anynumber);
}