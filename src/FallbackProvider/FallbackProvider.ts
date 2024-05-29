import { promiseWithTimeout, wait } from "../utils/promises";
import { isWebSocketProvider } from "../utils/ws-util";
import {
    JsonRpcApiProvider,
    JsonRpcApiProviderOptions,
    JsonRpcError,
    JsonRpcPayload,
    JsonRpcResult,
    Network,
    Networkish,
    WebSocketProvider,
} from "ethers";

export enum FallbackProviderError {
    NO_PROVIDER = "At least one provider must be provided",
    CANNOT_DETECT_NETWORKS = "Could not detect providers networks",
    INCONSISTENT_NETWORKS = "All providers must be connected to the same network",
}
export const DEFAULT_RETRIES = 0;
export const DEFAULT_TIMEOUT = 3_000;
export const RETRY_DELAY = 100;

export interface ProviderConfig {
    provider: JsonRpcApiProvider;
    retries?: number;
    timeout?: number;
    retryDelay?: number;
}

export interface LoggingOptions {
    debug?: (message: string) => void;
    warn?: (message: string) => void;
}

export const filterValidProviders = async (providers: ProviderConfig[]) => {
    if (providers.length === 0) throw new Error(FallbackProviderError.NO_PROVIDER);

    const networks = await Promise.all(providers.map(({ provider }) => provider.getNetwork().catch(() => null)));
    const availableNetworks: Network[] = [];
    const availableProviders: ProviderConfig[] = [];
    networks.forEach((network, i) => {
        if (!network) return;
        availableNetworks.push(network);
        availableProviders.push(providers[i]);
    });

    if (availableNetworks.length === 0) throw new Error(FallbackProviderError.CANNOT_DETECT_NETWORKS);

    const defaultNetwork = availableNetworks[0];

    if (availableNetworks.find((n) => n.chainId !== defaultNetwork.chainId))
        throw new Error(FallbackProviderError.INCONSISTENT_NETWORKS);

    return { network: defaultNetwork, providers: availableProviders };
};

export class FallbackProvider extends JsonRpcApiProvider {
    #providers: ProviderConfig[];
    #logging: LoggingOptions;

    constructor(
        providers: ProviderConfig[],
        network?: Networkish,
        options?: JsonRpcApiProviderOptions,
        loggingOptions?: LoggingOptions
    ) {
        super(network, options);

        this.#providers = providers;
        this.#logging = loggingOptions ?? {};

        this._start();
    }

    private async sendWithProvider(
        providers: ProviderConfig[],
        providerIndex: number,
        method: string,
        params: { [name: string]: any },
        retries = 0,
        useFallback = true
    ): Promise<any> {
        const { provider, retries: maxRetries, timeout, retryDelay } = providers[providerIndex];

        try {
            if (isWebSocketProvider(provider)) {
                // Provider is a WebSocketProvider. Let's perform some additional checks.
                const readyState = (provider as WebSocketProvider).websocket.readyState;

                if (readyState >= 2) {
                    // Closing or closed. Immediately fallback if possible.
                    this.#logging?.warn?.(`[FallbackProvider] Provider n°${providerIndex} websocket closed`);

                    if (providerIndex >= providers.length - 1) {
                        throw new Error(
                            `[FallbackProvider] Provider n°${providerIndex} websocket closed with no fallback available`
                        );
                    }

                    // We have another provider to fallback to.
                    return this.sendWithProvider(providers, providerIndex + 1, method, params);
                }

                if (readyState !== 1) {
                    // Websocket still connecting. Fallback if possible.
                    if (providerIndex < providers.length - 1) {
                        this.#logging?.warn?.(
                            `[FallbackProvider] Provider n°${providerIndex} websocket not ready. Fallbacking to provider n°${
                                providerIndex + 1
                            }`
                        );

                        try {
                            return await this.sendWithProvider(providers, providerIndex + 1, method, params);
                        } catch (e2) {
                            console.warn(`[FallbackProvider] Fallback failed: ${e2}`);
                        }
                    }

                    // If we're here, we failed to fallback and we know the websocket is not closed. Let's try sending the request
                    // to it below.

                    // We already tried to fallback, let's not do it again.
                    useFallback = false;
                }
            }

            return await promiseWithTimeout(provider.send(method, params), timeout ?? DEFAULT_TIMEOUT);
        } catch (e) {
            if (retries < (maxRetries ?? DEFAULT_RETRIES)) {
                // Wait for a random time before retrying.
                const delay = Math.ceil(Math.random() * (retryDelay ?? RETRY_DELAY));
                this.#logging?.debug?.(
                    `[FallbackProvider] Call to \`${method}\` failing with provider n°${providerIndex}, retrying in ${delay}ms (${
                        retries + 1
                    }/${maxRetries}) \n\n${e}`
                );
                await wait(delay);
                return this.sendWithProvider(providers, providerIndex, method, params, retries + 1, useFallback);
            }
            if (providerIndex >= providers.length - 1 || !useFallback) throw e;

            this.#logging?.warn?.(
                `[FallbackProvider] Call to \`${method}\` failing with provider n°${providerIndex}, retrying with provider n°${
                    providerIndex + 1
                }\n\n${e}`
            );
            return this.sendWithProvider(providers, providerIndex + 1, method, params);
        }
    }

    async send(method: string, params: { [name: string]: any }): Promise<any> {
        if (method === "eth_chainId") {
            return (await filterValidProviders(this.#providers)).network.chainId;
        }

        return this.sendWithProvider(this.#providers, 0, method, params);
    }

    async _send(payload: JsonRpcPayload | Array<JsonRpcPayload>): Promise<Array<JsonRpcResult | JsonRpcError>> {
        throw new Error("Method not implemented.");
    }
}
