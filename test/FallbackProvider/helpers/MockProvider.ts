import { JsonRpcApiProvider, JsonRpcError, JsonRpcPayload, JsonRpcResult, Network } from "ethers";
import { wait } from "../../../src/utils/promises";

export default class MockProvider extends JsonRpcApiProvider {
    constructor(
        protected _id: string,
        protected _networkId = 1,
        public blockNumber = 1,
        protected delay = 0,
    ) {
        super(_networkId, {
            cacheTimeout: -1, // Disable caching
            batchMaxCount: 1, // Disable batching
        });
    }

    async _detectNetwork(): Promise<Network> {
        if (this._networkId === 0) throw new Error("Network id is 0");

        return Network.from({
            name: `Network ${this._networkId}`,
            chainId: this._networkId,
        });
    }

    async sendNonBlockNumberCall(method: string, params: { [name: string]: any }): Promise<any> {
        if (this.delay) {
            await wait(this.delay);
        }

        return this._id;
    }

    async send(method: string, params: { [name: string]: any }): Promise<any> {
        this._start();

        if (method === "eth_blockNumber") {
            return this.blockNumber;
        }

        return await this.sendNonBlockNumberCall(method, params);
    }

    async _send(payload: JsonRpcPayload | Array<JsonRpcPayload>): Promise<Array<JsonRpcResult | JsonRpcError>> {
        throw new Error("Method not implemented.");
    }
}
