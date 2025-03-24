import { ErrorCode, makeError } from "ethers";
import MockProvider from "./MockProvider";
import { wait } from "../../../src/utils/promises";

export default class FailingProvider extends MockProvider {
    failureCount = 0;

    constructor(
        _id: string,
        protected _numberOfFailures = 100,
        protected _blockNumber = 1,
        protected _errorCode: ErrorCode = "NETWORK_ERROR",
        _delay = 0,
    ) {
        super(_id, undefined, undefined, _delay);
    }

    async sendNonBlockNumberCall(method: string, params: { [name: string]: any }): Promise<any> {
        if (this.delay) {
            await wait(this.delay);
        }

        this.failureCount++;
        if (this.failureCount > this._numberOfFailures) {
            this.failureCount = 0;

            if (method === "eth_blockNumber") {
                return this._blockNumber;
            }

            return this._id;
        }

        throw makeError("Failing provider used: " + this._id, this._errorCode);
    }

    async send(method: string, params: { [name: string]: any }): Promise<any> {
        return await this.sendNonBlockNumberCall(method, params);
    }
}
