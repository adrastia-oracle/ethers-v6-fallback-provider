import { wait } from "./promises";
import { JsonRpcApiProvider } from "ethers";

export abstract class ProviderModifiers {
    static failing<T extends JsonRpcApiProvider>(provider: T, probability = 1) {
        provider.send = async (method: string, params: any): Promise<any> => {
            if (Math.random() <= probability) throw new Error(`Failing provider used for method \`${method}\``);
            return provider.send(method, params);
        };
        return provider;
    }

    static delayed<T extends JsonRpcApiProvider>(provider: T, timeout: number) {
        provider.send = async (method: string, params: any): Promise<any> => {
            await wait(timeout);
            return provider.send(method, params);
        };
        return provider;
    }
}
