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
    DESTROYED = "Provider has been destroyed",
    ALL_PROVIDERS_UNAVAILABLE = "All providers are unavailable",
    HALTED = "Chain has halted",
    INVALID_FALLBACK_OPTIONS = "Invalid fallback options",
}
export const DEFAULT_RETRIES = 0;
export const DEFAULT_TIMEOUT = 3_000;
export const RETRY_DELAY = 100;

export interface ProviderConfig {
    provider: JsonRpcApiProvider;
    retries?: number;
    timeout?: number;
    retryDelay?: number;
    id?: string;
}

export interface LoggingOptions {
    debug?: (message: string, metadata?: any) => void;
    info?: (message: string, metadata?: any) => void;
    warn?: (message: string, metadata?: any) => void;
    error?: (message: string, metadata?: any) => void;
}

export type FallbackProviderOptions = {
    /**
     * Maximum block lag allowed for the provider to be considered valid. This is measured by against the median block
     * number.
     */
    allowableBlockLag?: number;

    /**
     * If the median block number is not updated for this amount of time, the chain is considered halted, and calls will
     * throw an error.
     *
     * Denominated in seconds. If set to 0, the halt detection will be disabled. If not set, the default value will be
     * used (5 minutes).
     *
     * If halt deletection is enabled, ensure that you have a mechanism to handle providers returning incorrect block
     * numbers, as this can cause the provider to be permanently marked as halted.
     */
    haltDetectionTime?: number;

    /**
     * Interval at which the provider will check the liveliness of the chain and of providers.
     *
     * Denominated in milliseconds. If set to 0, the liveliness check will be disabled. If not set, liveliness check
     * will be disabled.
     */
    livelinessPollingInterval?: number;

    /**
     * A function that allows the provider to get the time at which a block was first discovered. If the function is not
     * provided, the provider will use instance variables to get the block discovery time.
     *
     * @param blockNumber The block number to check. If the block number is less than the last discovered block number,
     * the time at which the latest block was discovered is returned.
     *
     * @returns A timestamp of when the block (or the latest block) was discovered, in UNIX epoch time. If the block is
     * new, `null` is returned.
     */
    getBlockDiscoveryTime?: (blockNumber: number) => Promise<number | null>;

    /**
     * A function that allows the provider to set the time at which a block was first discovered. If the function is not
     * provided, the provider will use instance variables to store the block discovery time.
     *
     * @param blockNumber The block number to set the discovery time for. If the block number is less than the last
     * discovered block number, the function should not update the discovery time.
     * @param currentTime The current time, in UNIX epoch time. If the block is new, this value should be used to set
     * the discovery time. If null, the function should clear the discovery time.
     */
    setBlockDiscoveryTime?: (blockNumber: number, currentTime: number | null) => Promise<void>;

    /**
     * If true, the provider will broadcast signed transactions to all of the active providers at once. If false, the
     * provider will broadcast the transaction in the same fashion as all other calls. Default: false.
     */
    broadcastToAll?: boolean;
};

export const DEFAULT_FALLBACK_OPTIONS: FallbackProviderOptions = {
    allowableBlockLag: 2,
    haltDetectionTime: 5 * 60, // 5 minutes
    livelinessPollingInterval: 0, // Disabled
    broadcastToAll: false,
};

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

export async function getBlockNumberWithTimeout(provider: JsonRpcApiProvider, timeout = 5000): Promise<number> {
    return new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error("Timeout"));
        }, timeout);

        provider
            .getBlockNumber()
            .then((blockNumber) => {
                clearTimeout(timer);
                resolve(blockNumber);
            })
            .catch((error) => {
                clearTimeout(timer);
                reject(error);
            });
    }).catch((error) => {
        throw error;
    });
}

export const getBlockNumbersAndMedian = async (providers: ProviderConfig[]) => {
    const blockNumbers = await Promise.all(
        providers.map(({ provider, timeout }) =>
            getBlockNumberWithTimeout(provider, timeout ?? DEFAULT_TIMEOUT).catch(() => null),
        ),
    );

    // Filter out the undefined block numbers.
    const filteredBlockNumbers = blockNumbers.filter((blockNumber) => blockNumber !== null) as number[];
    if (filteredBlockNumbers.length === 0) {
        throw new Error(FallbackProviderError.ALL_PROVIDERS_UNAVAILABLE);
    }

    // Sort the valid block numbers.
    const sortedBlockNumbers = filteredBlockNumbers.sort((a, b) => a - b);
    // Calculate the median, computing the middle value if the length is odd.
    let median: number;
    if (sortedBlockNumbers.length % 2 === 0) {
        const middle = sortedBlockNumbers.length / 2;
        median = (sortedBlockNumbers[middle - 1] + sortedBlockNumbers[middle]) / 2;
    } else {
        median = sortedBlockNumbers[Math.floor(sortedBlockNumbers.length / 2)];
    }

    // Median should be an integer. Round down if it's not.
    median = Math.floor(median);

    return { blockNumbers: blockNumbers, median: median };
};

export class FallbackProvider extends JsonRpcApiProvider {
    #providers: ProviderConfig[];
    #logging: LoggingOptions;
    #fallbackOptions: FallbackProviderOptions;

    #active = false;
    #destroyed = false;
    #halted = false;
    #activeProviders: ProviderConfig[] = [];

    #latestBlockDiscovery: {
        blockNumber: number | null;
        time: number;
    } = {
        blockNumber: null,
        time: 0,
    };

    constructor(
        providers: ProviderConfig[],
        network?: Networkish,
        options?: JsonRpcApiProviderOptions,
        loggingOptions?: LoggingOptions,
        fallbackOptions?: FallbackProviderOptions,
    ) {
        super(network, options);

        this._validateFallbackOptions(fallbackOptions);

        this.#activeProviders = this.#providers = providers;
        this.#logging = loggingOptions ?? {};
        this.#fallbackOptions = fallbackOptions ?? {};

        // Add IDs to the providers if they don't have them.
        this.#providers.forEach((provider, i) => {
            if (!provider.id) {
                provider.id = `${i}`;
            }
        });

        this._start();
    }

    public activeProvidersCount(): number {
        return this.#activeProviders.length;
    }

    public isHalted(): boolean {
        return this.#halted;
    }

    private _validateFallbackOptions(options: FallbackProviderOptions | undefined) {
        if (!options) {
            // No options provided. Using the default options.
            return;
        }

        if (options.allowableBlockLag !== undefined && options.allowableBlockLag < 0) {
            throw new Error(FallbackProviderError.INVALID_FALLBACK_OPTIONS);
        }

        if (options.haltDetectionTime !== undefined && options.haltDetectionTime < 0) {
            throw new Error(FallbackProviderError.INVALID_FALLBACK_OPTIONS);
        }

        if (options.livelinessPollingInterval !== undefined && options.livelinessPollingInterval < 0) {
            throw new Error(FallbackProviderError.INVALID_FALLBACK_OPTIONS);
        }
    }

    private async sendWithProvider(
        providers: ProviderConfig[],
        providerIndex: number,
        method: string,
        params: { [name: string]: any },
        retries = 0,
        useFallback = true,
    ): Promise<any> {
        const { provider, retries: maxRetries, timeout, retryDelay, id } = providers[providerIndex];

        const nextProviderId = providerIndex < providers.length - 1 ? providers[providerIndex + 1].id : null;

        try {
            if (isWebSocketProvider(provider)) {
                // Provider is a WebSocketProvider. Let's perform some additional checks.
                const readyState = (provider as WebSocketProvider).websocket.readyState;

                if (readyState >= 2) {
                    // Closing or closed. Immediately fallback if possible.
                    this.#logging?.warn?.(`[FallbackProvider] Provider ${id} websocket closed`);

                    if (providerIndex >= providers.length - 1) {
                        throw new Error(
                            `[FallbackProvider] Provider ${id} websocket closed with no fallback available`,
                        );
                    }

                    // We have another provider to fallback to.
                    return this.sendWithProvider(providers, providerIndex + 1, method, params);
                }

                if (readyState !== 1) {
                    // Websocket still connecting. Fallback if possible.
                    if (providerIndex < providers.length - 1) {
                        this.#logging?.warn?.(
                            `[FallbackProvider] Provider ${id} websocket not ready. Fallbacking to provider ${nextProviderId}`,
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
                    `[FallbackProvider] Call to \`${method}\` failing with provider ${id}, retrying in ${delay}ms (${
                        retries + 1
                    }/${maxRetries}) \n\n${e}`,
                );
                await wait(delay);
                return this.sendWithProvider(providers, providerIndex, method, params, retries + 1, useFallback);
            }
            if (providerIndex >= providers.length - 1 || !useFallback) throw e;

            this.#logging?.warn?.(
                `[FallbackProvider] Call to \`${method}\` failing with provider ${id}, retrying with provider ${
                    nextProviderId
                }\n\n${e}`,
            );
            return this.sendWithProvider(providers, providerIndex + 1, method, params);
        }
    }

    async send(method: string, params: { [name: string]: any }): Promise<any> {
        if (this.#destroyed) {
            throw new Error(FallbackProviderError.DESTROYED);
        }
        if (this.#halted) {
            throw new Error(FallbackProviderError.HALTED);
        }

        if (method === "eth_chainId") {
            return (await filterValidProviders(this.#activeProviders)).network.chainId;
        } else if (method === "eth_sendRawTransaction") {
            // Check if we should broadcast to all providers.
            const broadcastToAll = this.#fallbackOptions.broadcastToAll ?? DEFAULT_FALLBACK_OPTIONS.broadcastToAll;
            if (broadcastToAll) {
                // Broadcast to all providers.
                const promises = this.#activeProviders.map((provider) =>
                    this.sendWithProvider([provider], 0, method, params),
                );

                try {
                    // Wait for the first result.
                    const result = await Promise.any(promises);

                    return result;
                } catch (error: any) {
                    // If all promises throw errors, it should throw the first error.
                    throw error.errors[0];
                }
            }
        }

        return this.sendWithProvider(this.#activeProviders, 0, method, params);
    }

    async _send(payload: JsonRpcPayload | Array<JsonRpcPayload>): Promise<Array<JsonRpcResult | JsonRpcError>> {
        throw new Error("Method not implemented.");
    }

    /**
     * Gets the time at which a block was first discovered.
     *
     * @param blockNumber The block number to check. If the block number is less than the last discovered block number,
     * the time at which the latest block was discovered is returned.
     *
     * @returns A timestamp of when the block (or the latest block) was discovered, in UNIX epoch time. If the block is
     * new, `null` is returned.
     */
    private async _getBlockDiscoveryTime(blockNumber: number): Promise<number | null> {
        if (this.#fallbackOptions.getBlockDiscoveryTime) {
            return this.#fallbackOptions.getBlockDiscoveryTime(blockNumber);
        }

        const latest = this.#latestBlockDiscovery;
        if (latest.blockNumber === null) {
            return null;
        }

        if (blockNumber <= latest.blockNumber) {
            return latest.time;
        }

        return null;
    }

    /**
     * Sets the time at which a block was first discovered.
     *
     * @param blockNumber The block number to set the discovery time for. If the block number is less than the last
     * discovered block number, the function should not update the discovery time.
     * @param currentTime The current time, in UNIX epoch time. If the block is new, this value should be used to set
     * the discovery time. If null, the function should clear the discovery time.
     */
    private async _setBlockDiscoveryTime(blockNumber: number, currentTime: number | null): Promise<void> {
        if (this.#fallbackOptions.setBlockDiscoveryTime) {
            return this.#fallbackOptions.setBlockDiscoveryTime(blockNumber, currentTime);
        }

        const latest = this.#latestBlockDiscovery;
        if (currentTime === null) {
            this.#latestBlockDiscovery = {
                blockNumber: null,
                time: 0,
            };

            return;
        }

        if (latest.blockNumber !== null) {
            // We have a latest block to check against.
            if (blockNumber <= latest.blockNumber) {
                // We don't update the discovery time if the block is not new.
                return;
            }
        }

        this.#latestBlockDiscovery = {
            blockNumber: blockNumber,
            time: currentTime,
        };
    }

    private async _livelinessCheck() {
        const providersToCheck = this.#providers;

        let goodProviders: ProviderConfig[] = [];

        try {
            // Get the block numbers and the median.
            const { blockNumbers, median } = await getBlockNumbersAndMedian(providersToCheck);

            // Get the current time, in UNIX epoch time.
            const currentTime = Math.floor(Date.now() / 1000);

            // Filter the providers that are not too far behind the median.
            const allowableBlockLag =
                this.#fallbackOptions.allowableBlockLag ?? DEFAULT_FALLBACK_OPTIONS.allowableBlockLag;
            const minBlockNumber = median - allowableBlockLag!;

            for (let i = 0; i < blockNumbers.length; i++) {
                const blockNumber = blockNumbers[i];
                if (blockNumber === null) {
                    continue;
                }

                if (blockNumber >= minBlockNumber) {
                    goodProviders.push(providersToCheck[i]);
                }
            }

            this.#activeProviders = goodProviders;

            // We've filtered the providers by allowable block lag. Now let's check if the chain has halted.
            const blockDiscoveryTime = await this._getBlockDiscoveryTime(median);
            if (blockDiscoveryTime === null) {
                // The block is new. We'll set the block discovery time.
                await this._setBlockDiscoveryTime(median, currentTime);

                this.#halted = false;
            } else {
                // The block is not new. Let's check if the chain has halted.
                const haltDetectionTime =
                    this.#fallbackOptions.haltDetectionTime ?? DEFAULT_FALLBACK_OPTIONS.haltDetectionTime;

                if (haltDetectionTime! > 0) {
                    if (currentTime - blockDiscoveryTime > haltDetectionTime!) {
                        // The chain has halted.
                        this.#halted = true;
                    } else {
                        this.#halted = false;
                    }
                } else {
                    // Halt detection is disabled.
                    this.#halted = false;
                }
            }
        } catch (e: any) {
            this.#logging?.error?.(`[FallbackProvider] Liveliness check failed: ${e.message}`, {
                error: e,
            });

            if (e.message === FallbackProviderError.ALL_PROVIDERS_UNAVAILABLE) {
                this.#activeProviders = [];
            }
        }
    }

    _start(): void {
        if (this.#destroyed) {
            throw new Error(FallbackProviderError.DESTROYED);
        }

        if (!this.#active) {
            this.#active = true;

            const pollingInterval =
                this.#fallbackOptions.livelinessPollingInterval ?? DEFAULT_FALLBACK_OPTIONS.livelinessPollingInterval;
            if (pollingInterval! > 0) {
                // Liveliness checks are enabled. Start the interval.
                const intervalId = setInterval(async () => {
                    if (!this.#active) {
                        clearInterval(intervalId); // Stop the interval if #active is false

                        return;
                    }

                    await this._livelinessCheck(); // Call the async function
                }, pollingInterval);
            }
        }

        super._start();
    }

    destroy(): void {
        this.#destroyed = true;
        this.#active = false;
        super.destroy();

        // Try and destory all providers.
        this.#providers.forEach(({ provider }) => {
            try {
                provider.destroy();
            } catch (e: any) {
                this.#logging?.error?.(`[FallbackProvider] Error destroying provider: ${e.message}`, {
                    error: e,
                });
            }
        });
    }
}
