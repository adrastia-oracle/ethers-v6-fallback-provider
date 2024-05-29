import MockProvider from "./MockProvider";

export default class FailingProvider extends MockProvider {
    failureCount = 0;
    constructor(_id: string, protected _numberOfFailures = 100) {
        super(_id);
    }
    async send(): Promise<string> {
        this.failureCount++;
        if (this.failureCount > this._numberOfFailures) {
            this.failureCount = 0;
            return this._id;
        }
        throw Error("Failing provider used: " + this._id);
    }
}
