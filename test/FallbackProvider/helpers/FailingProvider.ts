import MockProvider from "./MockProvider";

export default class FailingProvider extends MockProvider {
    failureCount = 0;

    constructor(_id: string, protected _numberOfFailures = 100, protected _blockNumber = 1) {
        super(_id);
    }

    async sendNonBlockNumberCall(method: string, params: { [name: string]: any }): Promise<any> {
        this.failureCount++;
        if (this.failureCount > this._numberOfFailures) {
            this.failureCount = 0;
            return this._id;
        }

        throw Error("Failing provider used: " + this._id);
    }

    async send(method: string, params: { [name: string]: any }): Promise<any> {
        if (method === "eth_blockNumber") {
            return this._blockNumber;
        }

        return await this.sendNonBlockNumberCall(method, params);
    }
}
