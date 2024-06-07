import { promiseWithTimeout } from "../../../src/utils/promises";
import { default as MockProvider } from "./MockProvider";
import { default as MockWebsocket } from "./MockWebsocket";

export default class MockWebsocketProvider extends MockProvider {
    protected _websocket = new MockWebsocket();

    constructor(_id: string, _networkId = 1, protected _blockNumber = 1) {
        super(_id, _networkId);
    }

    setWsReadyState(state: number) {
        this._websocket.readyState = state;
    }

    get websocket() {
        return this._websocket;
    }

    async sendNonBlockNumberCall(method: string, params: { [name: string]: any }): Promise<any> {
        const state = this._websocket.readyState;

        if (state == 0) {
            // Wait until the readyState is 1, timeout after 10 seconds
            const startTime = Date.now();
            const timeout = 10000;
            const promise = new Promise((resolve, reject) => {
                const interval = setInterval(() => {
                    if (this._websocket.readyState === 1) {
                        clearInterval(interval);
                        resolve(this._id);
                    } else if (Date.now() - startTime > timeout + 1000) {
                        clearInterval(interval);
                        reject("Websocket did not become ready");
                    }
                }, 10);
            }) as Promise<string>;
            return await promiseWithTimeout(promise, timeout);
        } else if (state === 1) {
            return this._id;
        } else {
            throw new Error("Websocket is not ready");
        }
    }

    async send(method: string, params: { [name: string]: any }): Promise<any> {
        this._start();

        if (method === "eth_blockNumber") {
            return this._blockNumber;
        }

        return await this.sendNonBlockNumberCall(method, params);
    }
}
