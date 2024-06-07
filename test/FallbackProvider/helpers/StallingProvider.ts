import { promiseWithTimeout } from "../../../src/utils/promises";
import { default as MockProvider } from "./MockProvider";

export default class StallingProvider extends MockProvider {
    constructor(_id: string, _networkId = 1, protected _blockNumber = 1) {
        super(_id, _networkId);
    }

    async send(method: string, params: { [name: string]: any }): Promise<any> {
        this._start();

        // Wait until the readyState is 1, timeout after 10 seconds
        const startTime = Date.now();
        const timeout = 10000;
        const promise = new Promise((resolve, reject) => {
            const interval = setInterval(() => {
                if (Date.now() - startTime > timeout + 1000) {
                    clearInterval(interval);
                    reject("Timeout");
                }
            }, 10);
        }) as Promise<string>;
        return await promiseWithTimeout(promise, timeout);
    }
}
