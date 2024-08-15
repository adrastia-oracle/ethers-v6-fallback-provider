import {
    DEFAULT_TIMEOUT,
    FallbackProvider,
    FallbackProviderError,
    FallbackProviderOptions,
    filterValidProviders,
    getBlockNumber,
    getBlockNumbersAndMedian,
} from "../../src/FallbackProvider";
import { wait } from "../../src/utils/promises";
import FailingProvider from "./helpers/FailingProvider";
import MockProvider from "./helpers/MockProvider";
import MockWebsocketProvider from "./helpers/MockWebsocketProvider";
import RecoveringProvider from "./helpers/RecoveringProvider";
import StallingProvider from "./helpers/StallingProvider";

const LIVELINESS_FALLBACK_OPTIONS: FallbackProviderOptions = {
    allowableBlockLag: 2,
    haltDetectionTime: 5 * 60, // 5 minutes
    livelinessPollingInterval: 10, // 10ms
};
const LIVELINESS_PROVIDER_TIMEOUT = 100;

describe("FallbackProvider", () => {
    beforeEach(() => {
        jest.spyOn(console, "warn").mockImplementation(() => {});
    });

    describe("detectNetwork", () => {
        it("should throw an error if no provider is provided", async () => {
            await expect(filterValidProviders([])).rejects.toThrowError(FallbackProviderError.NO_PROVIDER);
        });

        it("should throw an error if it cannot detect providers network", async () => {
            const provider1 = new MockProvider("1", 0);
            const provider2 = new MockProvider("2", 0);

            await expect(filterValidProviders([provider1, provider2])).rejects.toThrowError(
                FallbackProviderError.CANNOT_DETECT_NETWORKS,
            );
        });

        it("should throw an error if all providers are not connected to the same network", async () => {
            const provider1 = new MockProvider("1", 1);
            const provider2 = new MockProvider("2", 2);

            await expect(filterValidProviders([provider1, provider2])).rejects.toThrowError(
                FallbackProviderError.INCONSISTENT_NETWORKS,
            );
        });

        it("should return the providers' network and the list of available providers", async () => {
            const provider1 = new MockProvider("1", 1);
            const provider2 = new MockProvider("2", 0);
            const provider3 = new MockProvider("3", 1);

            const { network, providers } = await filterValidProviders([provider1, provider2, provider3]);

            expect(network.chainId).toEqual(1n);
            expect(providers).toHaveLength(2);
            expect(providers[0].provider).toEqual(provider1);
            expect(providers[1].provider).toEqual(provider3);
        });
    });

    describe("getBlockNumber11", () => {
        it("failing and doesn't use retries if that option is set to zero", async () => {
            const provider = new FailingProvider("1", 1, 10);

            jest.spyOn(provider, "send");

            await expect(
                getBlockNumber({
                    provider,
                    retries: 0,
                }),
            ).rejects.toThrow("Failing provider used: 1");

            expect(provider.send).toHaveBeenCalledTimes(1);
        });

        it("failing and retries once", async () => {
            const provider = new FailingProvider("1", 1, 10);

            jest.spyOn(provider, "send");

            const blockNumber = await getBlockNumber({
                provider,
                retries: 1,
            });

            expect(blockNumber).toEqual(10);

            expect(provider.send).toHaveBeenCalledTimes(2);
        });

        it("failing and retries twice", async () => {
            const provider = new FailingProvider("1", 2, 10);

            jest.spyOn(provider, "send");

            const blockNumber = await getBlockNumber({
                provider,
                retries: 2,
            });

            expect(blockNumber).toEqual(10);

            expect(provider.send).toHaveBeenCalledTimes(3);
        });
    });

    describe("getBlockNumbersAndMedian", () => {
        it("should throw an error if no provider is provided", async () => {
            await expect(getBlockNumbersAndMedian([])).rejects.toThrowError(
                FallbackProviderError.ALL_PROVIDERS_UNAVAILABLE,
            );
        });

        it("should use retries with failing providers", async () => {
            const underlyingBlockNumbers = [10, 11, 12];

            const provider1 = new FailingProvider("1", 1, underlyingBlockNumbers[0]);
            const provider2 = new FailingProvider("2", 1, underlyingBlockNumbers[1]);
            const provider3 = new MockProvider("3", 1, underlyingBlockNumbers[2]);

            jest.spyOn(provider1, "send");
            jest.spyOn(provider2, "send");
            jest.spyOn(provider3, "send");

            const { blockNumbers, median } = await getBlockNumbersAndMedian([
                {
                    provider: provider1,
                    retries: 1,
                },
                {
                    provider: provider2,
                    retries: 1,
                },
                {
                    provider: provider3,
                    retries: 1,
                },
            ]);

            expect(blockNumbers).toEqual([
                { blockNumber: underlyingBlockNumbers[0], fromCache: false },
                { blockNumber: underlyingBlockNumbers[1], fromCache: false },
                { blockNumber: underlyingBlockNumbers[2], fromCache: false },
            ]);
            expect(median).toEqual(underlyingBlockNumbers[1]);

            expect(provider1.send).toHaveBeenCalledTimes(2);
            expect(provider2.send).toHaveBeenCalledTimes(2);
            expect(provider3.send).toHaveBeenCalledTimes(1);
        });

        it("should report null for stalling providers", async () => {
            const provider1 = new MockProvider("1", 1, 10);
            const provider2 = new StallingProvider("2", 1, 1);

            jest.spyOn(provider1, "send");
            jest.spyOn(provider2, "send");

            const { blockNumbers, median } = await getBlockNumbersAndMedian([provider1, provider2]);

            expect(blockNumbers).toEqual([
                {
                    blockNumber: 10,
                    fromCache: false,
                },
                null,
            ]);
            expect(median).toEqual(10);

            expect(provider1.send).toHaveBeenCalledTimes(1);
            expect(provider2.send).toHaveBeenCalledTimes(1);
        });

        it("should throw an error if all providers are stalling", async () => {
            const provider1 = new StallingProvider("1", 1, 1);
            const provider2 = new StallingProvider("2", 1, 1);

            jest.spyOn(provider1, "send");
            jest.spyOn(provider2, "send");

            await expect(getBlockNumbersAndMedian([provider1, provider2])).rejects.toThrowError(
                FallbackProviderError.ALL_PROVIDERS_UNAVAILABLE,
            );

            expect(provider1.send).toHaveBeenCalledTimes(1);
            expect(provider2.send).toHaveBeenCalledTimes(1);
        });

        it("should return the block numbers and the median with some stalling providers", async () => {
            const underlyingBlockNumbers = [100, null, null];

            const provider1 = new MockProvider("1", 1, underlyingBlockNumbers[0] as number);
            const provider2 = new StallingProvider("1", 1, 1);
            const provider3 = new StallingProvider("1", 1, 1);

            jest.spyOn(provider1, "send");
            jest.spyOn(provider2, "send");
            jest.spyOn(provider3, "send");

            const { blockNumbers, median } = await getBlockNumbersAndMedian([provider1, provider2, provider3]);

            expect(blockNumbers).toEqual(
                underlyingBlockNumbers.map((blockNumber) =>
                    blockNumber == null ? null : { blockNumber, fromCache: false },
                ),
            );
            expect(median).toEqual(100);

            expect(provider1.send).toHaveBeenCalledTimes(1);
            expect(provider2.send).toHaveBeenCalledTimes(1);
            expect(provider3.send).toHaveBeenCalledTimes(1);
        });

        it("should return the block numbers and the median with some failing providers", async () => {
            const underlyingBlockNumbers = [100, null, null];

            const provider1 = new MockProvider("1", 1, underlyingBlockNumbers[0] as number);
            const provider2 = new FailingProvider("1", 1, 1);
            const provider3 = new FailingProvider("1", 1, 1);

            jest.spyOn(provider1, "send");
            jest.spyOn(provider2, "send");
            jest.spyOn(provider3, "send");

            const { blockNumbers, median } = await getBlockNumbersAndMedian([provider1, provider2, provider3]);

            expect(blockNumbers).toEqual(
                underlyingBlockNumbers.map((blockNumber) =>
                    blockNumber == null ? null : { blockNumber, fromCache: false },
                ),
            );
            expect(median).toEqual(100);

            expect(provider1.send).toHaveBeenCalledTimes(1);
            expect(provider2.send).toHaveBeenCalledTimes(1);
            expect(provider3.send).toHaveBeenCalledTimes(1);
        });

        it("should compute the median with an even number of block numbers", async () => {
            const underlyingBlockNumbers = [100, 200, 300, 400];

            const provider1 = new MockProvider("1", 1, underlyingBlockNumbers[0] as number);
            const provider2 = new MockProvider("1", 1, underlyingBlockNumbers[1] as number);
            const provider3 = new MockProvider("1", 1, underlyingBlockNumbers[2] as number);
            const provider4 = new MockProvider("1", 1, underlyingBlockNumbers[3] as number);

            jest.spyOn(provider1, "send");
            jest.spyOn(provider2, "send");
            jest.spyOn(provider3, "send");
            jest.spyOn(provider4, "send");

            const { blockNumbers, median } = await getBlockNumbersAndMedian([
                provider1,
                provider2,
                provider3,
                provider4,
            ]);

            expect(blockNumbers).toEqual(
                underlyingBlockNumbers.map((blockNumber) => ({ blockNumber, fromCache: false })),
            );
            expect(median).toEqual(250);

            expect(provider1.send).toHaveBeenCalledTimes(1);
            expect(provider2.send).toHaveBeenCalledTimes(1);
            expect(provider3.send).toHaveBeenCalledTimes(1);
            expect(provider4.send).toHaveBeenCalledTimes(1);
        });

        it("should compute the median with an odd number of block numbers", async () => {
            const underlyingBlockNumbers = [100, 200, 300];

            const provider1 = new MockProvider("1", 1, underlyingBlockNumbers[0] as number);
            const provider2 = new MockProvider("1", 1, underlyingBlockNumbers[1] as number);
            const provider3 = new MockProvider("1", 1, underlyingBlockNumbers[2] as number);

            jest.spyOn(provider1, "send");
            jest.spyOn(provider2, "send");
            jest.spyOn(provider3, "send");

            const { blockNumbers, median } = await getBlockNumbersAndMedian([provider1, provider2, provider3]);

            expect(blockNumbers).toEqual(
                underlyingBlockNumbers.map((blockNumber) => ({ blockNumber, fromCache: false })),
            );
            expect(median).toEqual(200);

            expect(provider1.send).toHaveBeenCalledTimes(1);
            expect(provider2.send).toHaveBeenCalledTimes(1);
            expect(provider3.send).toHaveBeenCalledTimes(1);
        });

        it("should return an integer median, rounding down", async () => {
            const underlyingBlockNumbers = [101, 102];

            const provider1 = new MockProvider("1", 1, underlyingBlockNumbers[0] as number);
            const provider2 = new MockProvider("1", 1, underlyingBlockNumbers[1] as number);

            jest.spyOn(provider1, "send");
            jest.spyOn(provider2, "send");

            const { blockNumbers, median } = await getBlockNumbersAndMedian([provider1, provider2]);

            expect(blockNumbers).toEqual(
                underlyingBlockNumbers.map((blockNumber) => ({ blockNumber, fromCache: false })),
            );
            expect(median).toEqual(101);

            expect(provider1.send).toHaveBeenCalledTimes(1);
            expect(provider2.send).toHaveBeenCalledTimes(1);
        });

        describe("With cache", () => {
            it("should use the cache and not call on the providers", async () => {
                const underlyingBlockNumbers = [100, 200, 300];
                const cachedBlockNumbers = [98, 198, 298];

                const provider1 = new MockProvider("1", 1, underlyingBlockNumbers[0] as number);
                const provider2 = new MockProvider("1", 1, underlyingBlockNumbers[1] as number);
                const provider3 = new MockProvider("1", 1, underlyingBlockNumbers[2] as number);

                jest.spyOn(provider1, "send");
                jest.spyOn(provider2, "send");
                jest.spyOn(provider3, "send");

                const { blockNumbers, median } = await getBlockNumbersAndMedian([
                    {
                        provider: provider1,
                        getStoredBlockNumber: async () => {
                            return cachedBlockNumbers[0];
                        },
                    },
                    {
                        provider: provider2,
                        getStoredBlockNumber: async () => {
                            return cachedBlockNumbers[1];
                        },
                    },
                    {
                        provider: provider3,
                        getStoredBlockNumber: async () => {
                            return cachedBlockNumbers[2];
                        },
                    },
                ]);

                expect(blockNumbers).toEqual(
                    cachedBlockNumbers.map((blockNumber) => ({ blockNumber, fromCache: true })),
                );
                expect(median).toEqual(cachedBlockNumbers[1]);

                expect(provider1.send).not.toHaveBeenCalled();
                expect(provider2.send).not.toHaveBeenCalled();
                expect(provider3.send).not.toHaveBeenCalled();
            });

            it("should call on the providers if the cache is outdated", async () => {
                const underlyingBlockNumbers = [100, 200, 300];

                const provider1 = new MockProvider("1", 1, underlyingBlockNumbers[0] as number);
                const provider2 = new MockProvider("1", 1, underlyingBlockNumbers[1] as number);
                const provider3 = new MockProvider("1", 1, underlyingBlockNumbers[2] as number);

                jest.spyOn(provider1, "send");
                jest.spyOn(provider2, "send");
                jest.spyOn(provider3, "send");

                const { blockNumbers, median } = await getBlockNumbersAndMedian([
                    {
                        provider: provider1,
                        getStoredBlockNumber: async () => {
                            return null;
                        },
                    },
                    {
                        provider: provider2,
                        getStoredBlockNumber: async () => {
                            return null;
                        },
                    },
                    {
                        provider: provider3,
                        getStoredBlockNumber: async () => {
                            return null;
                        },
                    },
                ]);

                expect(blockNumbers).toEqual(
                    underlyingBlockNumbers.map((blockNumber) => ({ blockNumber, fromCache: false })),
                );
                expect(median).toEqual(200);

                expect(provider1.send).toHaveBeenCalledTimes(1);
                expect(provider2.send).toHaveBeenCalledTimes(1);
                expect(provider3.send).toHaveBeenCalledTimes(1);
            });

            it("should call on the providers if the cache throws an error", async () => {
                const underlyingBlockNumbers = [100, 200, 300];

                const provider1 = new MockProvider("1", 1, underlyingBlockNumbers[0] as number);
                const provider2 = new MockProvider("1", 1, underlyingBlockNumbers[1] as number);
                const provider3 = new MockProvider("1", 1, underlyingBlockNumbers[2] as number);

                jest.spyOn(provider1, "send");
                jest.spyOn(provider2, "send");
                jest.spyOn(provider3, "send");

                const { blockNumbers, median } = await getBlockNumbersAndMedian([
                    {
                        provider: provider1,
                        getStoredBlockNumber: async () => {
                            throw new Error("Cache error");
                        },
                    },
                    {
                        provider: provider2,
                        getStoredBlockNumber: async () => {
                            throw new Error("Cache error");
                        },
                    },
                    {
                        provider: provider3,
                        getStoredBlockNumber: async () => {
                            throw new Error("Cache error");
                        },
                    },
                ]);

                expect(blockNumbers).toEqual(
                    underlyingBlockNumbers.map((blockNumber) => ({ blockNumber, fromCache: false })),
                );
                expect(median).toEqual(200);

                expect(provider1.send).toHaveBeenCalledTimes(1);
                expect(provider2.send).toHaveBeenCalledTimes(1);
                expect(provider3.send).toHaveBeenCalledTimes(1);
            });

            it("works with a mix of cached and uncached providers", async () => {
                const underlyingBlockNumbers = [100, 200, 300];
                const cachedBlockNumbers = [98, 198, 298];

                const provider1 = new MockProvider("1", 1, underlyingBlockNumbers[0] as number);
                const provider2 = new MockProvider("1", 1, underlyingBlockNumbers[1] as number);
                const provider3 = new MockProvider("1", 1, underlyingBlockNumbers[2] as number);

                jest.spyOn(provider1, "send");
                jest.spyOn(provider2, "send");
                jest.spyOn(provider3, "send");

                const { blockNumbers, median } = await getBlockNumbersAndMedian([
                    {
                        provider: provider1,
                        getStoredBlockNumber: async () => {
                            return cachedBlockNumbers[0];
                        },
                    },
                    {
                        provider: provider2,
                        getStoredBlockNumber: async () => {
                            return null;
                        },
                    },
                    {
                        provider: provider3,
                        getStoredBlockNumber: async () => {
                            return cachedBlockNumbers[2];
                        },
                    },
                ]);

                expect(blockNumbers).toEqual([
                    { blockNumber: cachedBlockNumbers[0], fromCache: true },
                    { blockNumber: underlyingBlockNumbers[1], fromCache: false },
                    { blockNumber: cachedBlockNumbers[2], fromCache: true },
                ]);
                expect(median).toEqual(200);

                expect(provider1.send).not.toHaveBeenCalled();
                expect(provider2.send).toHaveBeenCalledTimes(1);
                expect(provider3.send).not.toHaveBeenCalled();
            });
        });
    });

    describe("perform", () => {
        let provider: FallbackProvider;

        afterEach(() => {
            if (provider) {
                provider.destroy();
            }
        });

        it("should return the first value if the first provider is successful", async () => {
            const provider1 = new MockProvider("1");
            const provider2 = new MockProvider("2");
            provider = new FallbackProvider([provider1, provider2]);

            jest.spyOn(provider1, "sendNonBlockNumberCall");
            jest.spyOn(provider2, "sendNonBlockNumberCall");

            const res = await provider.send("send", {});

            expect(provider1.sendNonBlockNumberCall).toHaveBeenCalledTimes(1);
            expect(provider2.sendNonBlockNumberCall).not.toHaveBeenCalled();
            expect(res).toEqual("1");
        });

        it("should return the second value if the first provider is failing", async () => {
            const provider1 = new FailingProvider("1");
            const provider2 = new MockProvider("2");
            provider = new FallbackProvider([provider1, provider2]);

            jest.spyOn(provider1, "sendNonBlockNumberCall");
            jest.spyOn(provider2, "sendNonBlockNumberCall");

            const res = await provider.send("send", {});

            expect(provider1.sendNonBlockNumberCall).toHaveBeenCalledTimes(1);
            expect(provider2.sendNonBlockNumberCall).toHaveBeenCalledTimes(1);
            expect(res).toEqual("2");
        });

        it("should fail if all providers are failing", async () => {
            const provider1 = new FailingProvider("1");
            const provider2 = new FailingProvider("2");
            provider = new FallbackProvider([provider1, provider2]);

            jest.spyOn(provider1, "sendNonBlockNumberCall");
            jest.spyOn(provider2, "sendNonBlockNumberCall");

            await expect(provider.send("send", {})).rejects.toThrowError("Failing provider used: 2");

            expect(provider1.sendNonBlockNumberCall).toHaveBeenCalledTimes(1);
            expect(provider2.sendNonBlockNumberCall).toHaveBeenCalledTimes(1);
        });

        it("should retry the first provider", async () => {
            const provider1 = new FailingProvider("1", 1);
            const provider2 = new FailingProvider("2");
            provider = new FallbackProvider([{ provider: provider1, retries: 1 }, provider2]);

            jest.spyOn(provider1, "sendNonBlockNumberCall");
            jest.spyOn(provider2, "sendNonBlockNumberCall");

            const res = await provider.send("send", {});

            expect(provider1.sendNonBlockNumberCall).toHaveBeenCalledTimes(2);
            expect(provider2.sendNonBlockNumberCall).not.toHaveBeenCalled();
            expect(res).toEqual("1");
        });
        it("should fallback after max retries reached", async () => {
            const provider1 = new FailingProvider("1", 2);
            const provider2 = new MockProvider("2");
            provider = new FallbackProvider([{ provider: provider1, retries: 1 }, provider2]);

            jest.spyOn(provider1, "sendNonBlockNumberCall");
            jest.spyOn(provider2, "sendNonBlockNumberCall");

            const res = await provider.send("send", {});

            expect(provider1.sendNonBlockNumberCall).toHaveBeenCalledTimes(2);
            expect(provider2.sendNonBlockNumberCall).toHaveBeenCalledTimes(1);
            expect(res).toEqual("2");
        });

        it("Should only broadcast to the first MEV-protected provider when desired", async () => {
            const provider1 = new MockProvider("1");
            const provider2 = new MockProvider("2");
            const provider3 = new MockProvider("3");
            provider = new FallbackProvider(
                [
                    {
                        provider: provider1,
                        isMevProtected: false,
                    },
                    {
                        provider: provider2,
                        isMevProtected: true,
                    },
                    {
                        provider: provider3,
                        isMevProtected: true,
                    },
                ],
                undefined,
                undefined,
                undefined,
                {
                    broadcastOnlyToMevProtected: true,
                },
            );

            jest.spyOn(provider1, "sendNonBlockNumberCall");
            jest.spyOn(provider2, "sendNonBlockNumberCall");
            jest.spyOn(provider3, "sendNonBlockNumberCall");

            const res = await provider.send("eth_sendRawTransaction", {});

            expect(provider1.sendNonBlockNumberCall).not.toHaveBeenCalled();
            expect(provider2.sendNonBlockNumberCall).toHaveBeenCalledTimes(1);
            expect(provider3.sendNonBlockNumberCall).not.toHaveBeenCalled();
            expect(res).toEqual("2");
        });

        it("Should fail to broadcast if no MEV-protected provider is available and we only broadcast to MEV-protected providers", async () => {
            const provider1 = new MockProvider("1");
            const provider2 = new MockProvider("2");
            const provider3 = new MockProvider("3");
            provider = new FallbackProvider(
                [
                    {
                        provider: provider1,
                        isMevProtected: false,
                    },
                    {
                        provider: provider2,
                        isMevProtected: false,
                    },
                    {
                        provider: provider3,
                        isMevProtected: false,
                    },
                ],
                undefined,
                undefined,
                undefined,
                {
                    broadcastOnlyToMevProtected: true,
                },
            );

            jest.spyOn(provider1, "sendNonBlockNumberCall");
            jest.spyOn(provider2, "sendNonBlockNumberCall");
            jest.spyOn(provider3, "sendNonBlockNumberCall");

            await expect(provider.send("eth_sendRawTransaction", {})).rejects.toThrowError(
                FallbackProviderError.ALL_PROVIDERS_UNAVAILABLE,
            );

            expect(provider1.sendNonBlockNumberCall).not.toHaveBeenCalled();
            expect(provider2.sendNonBlockNumberCall).not.toHaveBeenCalled();
            expect(provider3.sendNonBlockNumberCall).not.toHaveBeenCalled();
        });

        describe("Websocket providers", () => {
            it("should fallback if the websocket is closing", async () => {
                const provider1 = new MockWebsocketProvider("1");
                const provider2 = new MockProvider("2");
                provider = new FallbackProvider([provider1, provider2]);

                jest.spyOn(provider1, "sendNonBlockNumberCall");
                jest.spyOn(provider2, "sendNonBlockNumberCall");

                provider1.setWsReadyState(2);

                const res = await provider.send("send", {});

                expect(provider1.sendNonBlockNumberCall).not.toHaveBeenCalled();
                expect(provider2.sendNonBlockNumberCall).toHaveBeenCalledTimes(1);
                expect(res).toEqual("2");
            });

            it("should fallback if the websocket is closed", async () => {
                const provider1 = new MockWebsocketProvider("1");
                const provider2 = new MockProvider("2");
                provider = new FallbackProvider([provider1, provider2]);

                jest.spyOn(provider1, "sendNonBlockNumberCall");
                jest.spyOn(provider2, "sendNonBlockNumberCall");

                provider1.setWsReadyState(3);

                const res = await provider.send("send", {});

                expect(provider1.sendNonBlockNumberCall).not.toHaveBeenCalled();
                expect(provider2.sendNonBlockNumberCall).toHaveBeenCalledTimes(1);
                expect(res).toEqual("2");
            });

            it("should fallback if the websocket is not ready", async () => {
                const provider1 = new MockWebsocketProvider("1");
                const provider2 = new MockProvider("2");
                provider = new FallbackProvider([provider1, provider2]);

                jest.spyOn(provider1, "sendNonBlockNumberCall");
                jest.spyOn(provider2, "sendNonBlockNumberCall");

                provider1.setWsReadyState(0);

                const res = await provider.send("send", {});

                expect(provider1.sendNonBlockNumberCall).not.toHaveBeenCalled();
                expect(provider2.sendNonBlockNumberCall).toHaveBeenCalledTimes(1);
                expect(res).toEqual("2");
            });

            it("should not fallback if the websocket is ready", async () => {
                const provider1 = new MockWebsocketProvider("1");
                const provider2 = new MockProvider("2");
                provider = new FallbackProvider([provider1, provider2]);

                jest.spyOn(provider1, "sendNonBlockNumberCall");
                jest.spyOn(provider2, "sendNonBlockNumberCall");

                provider1.setWsReadyState(1);

                const res = await provider.send("send", {});

                expect(provider1.sendNonBlockNumberCall).toHaveBeenCalledTimes(1);
                expect(provider2.sendNonBlockNumberCall).not.toHaveBeenCalled();
                expect(res).toEqual("1");
            });

            it("should fallback if the websocket is connecting but then proceed with the ws provider when the fallback fails", async () => {
                const provider1 = new MockWebsocketProvider("1");
                const provider2 = new FailingProvider("2");
                provider = new FallbackProvider([provider1, provider2]);

                jest.spyOn(provider1, "sendNonBlockNumberCall");
                jest.spyOn(provider2, "sendNonBlockNumberCall");

                // When send is called on provider2, make provider1 ready.
                jest.spyOn(provider2, "sendNonBlockNumberCall").mockImplementationOnce(() => {
                    provider1.setWsReadyState(1);
                    return Promise.reject(new Error("Failed to send"));
                });

                provider1.setWsReadyState(0);

                const res = await provider.send("send", {});

                expect(provider1.sendNonBlockNumberCall).toHaveBeenCalledTimes(1);
                expect(provider2.sendNonBlockNumberCall).toHaveBeenCalledTimes(1);
                expect(res).toEqual("1");
            });

            it("should fallback if the websocket is closing, then fail when the fallback fails", async () => {
                const provider1 = new MockWebsocketProvider("1");
                const provider2 = new FailingProvider("2");
                provider = new FallbackProvider([provider1, provider2]);

                provider1.setWsReadyState(2);

                jest.spyOn(provider1, "sendNonBlockNumberCall");
                jest.spyOn(provider2, "sendNonBlockNumberCall");

                await expect(provider.send("send", {})).rejects.toThrowError("Failing provider used: 2");

                expect(provider1.sendNonBlockNumberCall).toHaveBeenCalledTimes(0); // Doesn't try sending since the ws is closing
                expect(provider2.sendNonBlockNumberCall).toHaveBeenCalledTimes(1);
            });

            it("should fallback if the websocket is closed, then fail when the fallback fails", async () => {
                const provider1 = new MockWebsocketProvider("1");
                const provider2 = new FailingProvider("2");
                provider = new FallbackProvider([provider1, provider2]);

                provider1.setWsReadyState(3);

                jest.spyOn(provider1, "sendNonBlockNumberCall");
                jest.spyOn(provider2, "sendNonBlockNumberCall");

                await expect(provider.send("send", {})).rejects.toThrowError("Failing provider used: 2");

                expect(provider1.sendNonBlockNumberCall).not.toHaveBeenCalled(); // Doesn't try sending since the ws is closing
                expect(provider2.sendNonBlockNumberCall).toHaveBeenCalledTimes(1);
            });

            it("should fallback if the websocket is forever connecting", async () => {
                const provider1 = new MockWebsocketProvider("1");
                const provider2 = new MockProvider("2");
                provider = new FallbackProvider([provider1, provider2]);

                jest.spyOn(provider1, "sendNonBlockNumberCall");
                jest.spyOn(provider2, "sendNonBlockNumberCall");

                provider1.setWsReadyState(0);

                const res = await provider.send("send", {});

                expect(provider1.sendNonBlockNumberCall).not.toHaveBeenCalled(); // Doesn't try sending since the ws never connects and we fallback
                expect(provider2.sendNonBlockNumberCall).toHaveBeenCalledTimes(1);
                expect(res).toEqual("2");
            });

            it("should fallback if the websocket is forever connecting, then proceed with the ws provider when the fallback fails, eventually failing", async () => {
                const provider1 = new MockWebsocketProvider("1");
                const provider2 = new FailingProvider("2");
                provider = new FallbackProvider([provider1, provider2]);

                jest.spyOn(provider1, "sendNonBlockNumberCall");
                jest.spyOn(provider2, "sendNonBlockNumberCall");

                provider1.setWsReadyState(0);

                await expect(provider.send("send", {})).rejects.toThrowError("timeout exceeded");

                expect(provider1.sendNonBlockNumberCall).toHaveBeenCalledTimes(1);
                expect(provider2.sendNonBlockNumberCall).toHaveBeenCalledTimes(1);
            });
        });

        describe("Liveliness", () => {
            it("Should filter out stalling providers", async () => {
                const provider1 = new StallingProvider("1", 1, 1);
                const provider2 = new MockProvider("2", 1, 1);
                provider = new FallbackProvider(
                    [
                        { provider: provider1, timeout: LIVELINESS_PROVIDER_TIMEOUT },
                        { provider: provider2, timeout: LIVELINESS_PROVIDER_TIMEOUT },
                    ],
                    undefined,
                    undefined,
                    undefined,
                    LIVELINESS_FALLBACK_OPTIONS,
                );

                // Wait some time for the liveliness check to run
                await wait(LIVELINESS_PROVIDER_TIMEOUT + LIVELINESS_FALLBACK_OPTIONS.livelinessPollingInterval! + 250);

                jest.spyOn(provider1, "sendNonBlockNumberCall");
                jest.spyOn(provider2, "sendNonBlockNumberCall");

                const res = await provider.send("send", {});

                expect(provider1.sendNonBlockNumberCall).not.toHaveBeenCalled();
                expect(provider2.sendNonBlockNumberCall).toHaveBeenCalledTimes(1);
                expect(res).toEqual("2");
                expect(provider.activeProvidersCount()).toEqual(1);
            });

            it("Should filter out failing providers", async () => {
                const provider1 = new FailingProvider("1", 10000, 1);
                const provider2 = new MockProvider("2", 1, 1);
                provider = new FallbackProvider(
                    [
                        { provider: provider1, timeout: LIVELINESS_PROVIDER_TIMEOUT },
                        { provider: provider2, timeout: LIVELINESS_PROVIDER_TIMEOUT },
                    ],
                    undefined,
                    undefined,
                    undefined,
                    LIVELINESS_FALLBACK_OPTIONS,
                );

                // Wait some time for the liveliness check to run
                await wait(LIVELINESS_PROVIDER_TIMEOUT + LIVELINESS_FALLBACK_OPTIONS.livelinessPollingInterval! + 250);

                jest.spyOn(provider1, "sendNonBlockNumberCall");
                jest.spyOn(provider2, "sendNonBlockNumberCall");

                const res = await provider.send("send", {});

                expect(provider1.sendNonBlockNumberCall).not.toHaveBeenCalled();
                expect(provider2.sendNonBlockNumberCall).toHaveBeenCalledTimes(1);
                expect(res).toEqual("2");
                expect(provider.activeProvidersCount()).toEqual(1);
            });

            it("Should filter out lagging providers", async () => {
                const blockNum = 100;
                const laggingBlockNum = blockNum - LIVELINESS_FALLBACK_OPTIONS.allowableBlockLag! - 1;

                const provider1 = new MockProvider("1", 1, laggingBlockNum);
                const provider2 = new MockProvider("2", 1, blockNum);
                const provider3 = new MockProvider("3", 1, blockNum);
                provider = new FallbackProvider(
                    [
                        { provider: provider1, timeout: LIVELINESS_PROVIDER_TIMEOUT },
                        { provider: provider2, timeout: LIVELINESS_PROVIDER_TIMEOUT },
                        { provider: provider3, timeout: LIVELINESS_PROVIDER_TIMEOUT },
                    ],
                    undefined,
                    undefined,
                    undefined,
                    LIVELINESS_FALLBACK_OPTIONS,
                );

                // Wait some time for the liveliness check to run
                await wait(LIVELINESS_PROVIDER_TIMEOUT + LIVELINESS_FALLBACK_OPTIONS.livelinessPollingInterval! + 250);

                jest.spyOn(provider1, "sendNonBlockNumberCall");
                jest.spyOn(provider2, "sendNonBlockNumberCall");
                jest.spyOn(provider3, "sendNonBlockNumberCall");

                const res = await provider.send("send", {});

                expect(provider1.sendNonBlockNumberCall).not.toHaveBeenCalled();
                expect(provider2.sendNonBlockNumberCall).toHaveBeenCalledTimes(1);
                expect(provider3.sendNonBlockNumberCall).not.toHaveBeenCalled();
                expect(res).toEqual("2");
                expect(provider.activeProvidersCount()).toEqual(2);
            });

            it("Should allow the maximum amount of lag", async () => {
                const blockNum = 100;
                const laggingBlockNum = blockNum - LIVELINESS_FALLBACK_OPTIONS.allowableBlockLag!;

                const provider1 = new MockProvider("1", 1, laggingBlockNum);
                const provider2 = new MockProvider("2", 1, blockNum);
                const provider3 = new MockProvider("3", 1, blockNum);
                provider = new FallbackProvider(
                    [
                        { provider: provider1, timeout: LIVELINESS_PROVIDER_TIMEOUT },
                        { provider: provider2, timeout: LIVELINESS_PROVIDER_TIMEOUT },
                        { provider: provider3, timeout: LIVELINESS_PROVIDER_TIMEOUT },
                    ],
                    undefined,
                    undefined,
                    undefined,
                    LIVELINESS_FALLBACK_OPTIONS,
                );

                // Wait some time for the liveliness check to run
                await wait(LIVELINESS_PROVIDER_TIMEOUT + LIVELINESS_FALLBACK_OPTIONS.livelinessPollingInterval! + 250);

                jest.spyOn(provider1, "sendNonBlockNumberCall");
                jest.spyOn(provider2, "sendNonBlockNumberCall");
                jest.spyOn(provider3, "sendNonBlockNumberCall");

                const res = await provider.send("send", {});

                expect(provider1.sendNonBlockNumberCall).toHaveBeenCalledTimes(1);
                expect(provider2.sendNonBlockNumberCall).not.toHaveBeenCalled();
                expect(provider3.sendNonBlockNumberCall).not.toHaveBeenCalled();
                expect(res).toEqual("1");
                expect(provider.activeProvidersCount()).toEqual(3);
            });

            it("Should filter out a failing provider then add it back when it recovers", async () => {
                const blockNum = 100;

                const provider1 = new RecoveringProvider("1", 1, blockNum);
                const provider2 = new MockProvider("2", 1, blockNum);
                const provider3 = new MockProvider("3", 1, blockNum);
                provider = new FallbackProvider(
                    [
                        { provider: provider1, timeout: LIVELINESS_PROVIDER_TIMEOUT },
                        { provider: provider2, timeout: LIVELINESS_PROVIDER_TIMEOUT },
                        { provider: provider3, timeout: LIVELINESS_PROVIDER_TIMEOUT },
                    ],
                    undefined,
                    undefined,
                    undefined,
                    LIVELINESS_FALLBACK_OPTIONS,
                );

                // Wait some time for the liveliness check to run
                await wait(LIVELINESS_PROVIDER_TIMEOUT + LIVELINESS_FALLBACK_OPTIONS.livelinessPollingInterval! + 250);

                jest.spyOn(provider1, "sendNonBlockNumberCall");
                jest.spyOn(provider2, "sendNonBlockNumberCall");
                jest.spyOn(provider3, "sendNonBlockNumberCall");

                const res = await provider.send("send", {});

                expect(provider1.sendNonBlockNumberCall).not.toHaveBeenCalled();
                expect(provider2.sendNonBlockNumberCall).toHaveBeenCalledTimes(1);
                expect(provider3.sendNonBlockNumberCall).not.toHaveBeenCalled();
                expect(res).toEqual("2");
                expect(provider.activeProvidersCount()).toEqual(2);

                provider1.failing = false;

                // Wait some time for the liveliness check to run again
                await wait(LIVELINESS_PROVIDER_TIMEOUT + LIVELINESS_FALLBACK_OPTIONS.livelinessPollingInterval! + 250);

                const res2 = await provider.send("send", {});

                expect(provider1.sendNonBlockNumberCall).toHaveBeenCalledTimes(1);
                expect(provider2.sendNonBlockNumberCall).toHaveBeenCalledTimes(1);
                expect(provider3.sendNonBlockNumberCall).not.toHaveBeenCalled();
                expect(res2).toEqual("1");
                expect(provider.activeProvidersCount()).toEqual(3);
            });

            it("Should call our custom block discovery time handlers", async () => {
                const blockNum = 100;

                const getBlockDiscoveryTime = jest.fn(async (blockNumber) => null);
                const setBlockDiscoveryTime = jest.fn(async (blockNumber, blockDiscoveryTime) => {});

                const provider1 = new MockProvider("1", 1, blockNum);
                const provider2 = new MockProvider("2", 1, blockNum);
                provider = new FallbackProvider(
                    [
                        { provider: provider1, timeout: LIVELINESS_PROVIDER_TIMEOUT },
                        { provider: provider2, timeout: LIVELINESS_PROVIDER_TIMEOUT },
                    ],
                    undefined,
                    undefined,
                    undefined,
                    {
                        ...LIVELINESS_FALLBACK_OPTIONS,
                        getBlockDiscoveryTime: getBlockDiscoveryTime,
                        setBlockDiscoveryTime: setBlockDiscoveryTime,
                    },
                );

                // Wait some time for the liveliness check to run
                await wait(LIVELINESS_PROVIDER_TIMEOUT + LIVELINESS_FALLBACK_OPTIONS.livelinessPollingInterval! + 250);

                expect(getBlockDiscoveryTime).toHaveBeenCalledWith(blockNum);
                expect(setBlockDiscoveryTime).toHaveBeenCalledWith(blockNum, expect.any(Number));
            });

            it("Throws a halted error if all providers are halted", async () => {
                const blockNum = 100;
                const unixEpochTime = Date.now() / 1000;
                const discoveryTime = unixEpochTime - LIVELINESS_FALLBACK_OPTIONS.haltDetectionTime! - 1;

                const getBlockDiscoveryTime = jest.fn(async (blockNumber) => {
                    if (blockNumber === blockNum) {
                        return discoveryTime;
                    } else {
                        return null;
                    }
                });
                const setBlockDiscoveryTime = jest.fn(async (blockNumber, blockDiscoveryTime) => {});

                const provider1 = new MockProvider("1", 1, blockNum);
                const provider2 = new MockProvider("2", 1, blockNum);
                provider = new FallbackProvider(
                    [
                        { provider: provider1, timeout: LIVELINESS_PROVIDER_TIMEOUT },
                        { provider: provider2, timeout: LIVELINESS_PROVIDER_TIMEOUT },
                    ],
                    undefined,
                    undefined,
                    undefined,
                    {
                        ...LIVELINESS_FALLBACK_OPTIONS,
                        getBlockDiscoveryTime: getBlockDiscoveryTime,
                        setBlockDiscoveryTime: setBlockDiscoveryTime,
                    },
                );

                // Wait some time for the liveliness check to run
                await wait(LIVELINESS_PROVIDER_TIMEOUT + LIVELINESS_FALLBACK_OPTIONS.livelinessPollingInterval! + 250);

                await expect(provider.send("send", {})).rejects.toThrowError(FallbackProviderError.HALTED);

                expect(getBlockDiscoveryTime).toHaveBeenCalledWith(blockNum);
                expect(setBlockDiscoveryTime).not.toHaveBeenCalled();
                expect(provider.activeProvidersCount()).toEqual(2);
                expect(provider.isHalted()).toEqual(true);
            });

            it("Recovers from a halted state if a provider recovers", async () => {
                const blockNum = 100;
                const unixEpochTime = Date.now() / 1000;
                const discoveryTime = unixEpochTime - LIVELINESS_FALLBACK_OPTIONS.haltDetectionTime! - 1;

                const getBlockDiscoveryTime = jest.fn(async (blockNumber) => {
                    if (blockNumber === blockNum) {
                        return discoveryTime;
                    } else {
                        return null;
                    }
                });
                const setBlockDiscoveryTime = jest.fn(async (blockNumber, blockDiscoveryTime) => {});

                const provider1 = new MockProvider("1", 1, blockNum);
                const provider2 = new MockProvider("2", 1, blockNum);
                provider = new FallbackProvider(
                    [
                        { provider: provider1, timeout: LIVELINESS_PROVIDER_TIMEOUT },
                        { provider: provider2, timeout: LIVELINESS_PROVIDER_TIMEOUT },
                    ],
                    undefined,
                    undefined,
                    undefined,
                    {
                        ...LIVELINESS_FALLBACK_OPTIONS,
                        getBlockDiscoveryTime: getBlockDiscoveryTime,
                        setBlockDiscoveryTime: setBlockDiscoveryTime,
                    },
                );

                // Wait some time for the liveliness check to run
                await wait(LIVELINESS_PROVIDER_TIMEOUT + LIVELINESS_FALLBACK_OPTIONS.livelinessPollingInterval! + 250);

                await expect(provider.send("send", {})).rejects.toThrowError(FallbackProviderError.HALTED);

                expect(getBlockDiscoveryTime).toHaveBeenCalledWith(blockNum);
                expect(setBlockDiscoveryTime).not.toHaveBeenCalled();
                expect(provider.activeProvidersCount()).toEqual(2);
                expect(provider.isHalted()).toEqual(true);

                const newBlockNum = blockNum + 1;

                provider1.blockNumber = newBlockNum;
                provider2.blockNumber = newBlockNum;

                // Wait some time for the liveliness check to run
                await wait(LIVELINESS_PROVIDER_TIMEOUT + LIVELINESS_FALLBACK_OPTIONS.livelinessPollingInterval! + 250);

                jest.spyOn(provider1, "sendNonBlockNumberCall");
                jest.spyOn(provider2, "sendNonBlockNumberCall");

                const res = await provider.send("send", {});

                expect(getBlockDiscoveryTime).toHaveBeenCalledWith(newBlockNum);
                expect(setBlockDiscoveryTime).toHaveBeenCalledWith(newBlockNum, expect.any(Number));

                expect(provider1.sendNonBlockNumberCall).toHaveBeenCalledTimes(1);
                expect(provider2.sendNonBlockNumberCall).not.toHaveBeenCalled();
                expect(res).toEqual("1");
                expect(provider.activeProvidersCount()).toEqual(2);
                expect(provider.isHalted()).toEqual(false);
            });

            it("Throws a halted error if all providers are halted, with the default halt detection mechanism", async () => {
                const blockNum = 100;
                const haltDetectionTime = 3; // 3 seconds

                const provider1 = new MockProvider("1", 1, blockNum);
                const provider2 = new MockProvider("2", 1, blockNum);
                provider = new FallbackProvider(
                    [
                        { provider: provider1, timeout: LIVELINESS_PROVIDER_TIMEOUT },
                        { provider: provider2, timeout: LIVELINESS_PROVIDER_TIMEOUT },
                    ],
                    undefined,
                    undefined,
                    undefined,
                    { ...LIVELINESS_FALLBACK_OPTIONS, haltDetectionTime: haltDetectionTime },
                );

                // Wait some time for the the chain to be detected as halted
                await wait(
                    LIVELINESS_PROVIDER_TIMEOUT +
                        LIVELINESS_FALLBACK_OPTIONS.livelinessPollingInterval! +
                        haltDetectionTime * 1000 +
                        1000,
                );

                await expect(provider.send("send", {})).rejects.toThrowError(FallbackProviderError.HALTED);

                expect(provider.activeProvidersCount()).toEqual(2);
                expect(provider.isHalted()).toEqual(true);
            });

            it("Recovers from a halted state if a provider recovers, with the default halt detection mechanism", async () => {
                const blockNum = 100;
                const haltDetectionTime = 3; // 3 seconds

                const provider1 = new MockProvider("1", 1, blockNum);
                const provider2 = new MockProvider("2", 1, blockNum);
                provider = new FallbackProvider(
                    [
                        { provider: provider1, timeout: LIVELINESS_PROVIDER_TIMEOUT },
                        { provider: provider2, timeout: LIVELINESS_PROVIDER_TIMEOUT },
                    ],
                    undefined,
                    undefined,
                    undefined,
                    { ...LIVELINESS_FALLBACK_OPTIONS, haltDetectionTime: haltDetectionTime },
                );

                // Wait some time for the the chain to be detected as halted
                await wait(
                    LIVELINESS_PROVIDER_TIMEOUT +
                        LIVELINESS_FALLBACK_OPTIONS.livelinessPollingInterval! +
                        haltDetectionTime * 1000 +
                        1000,
                );

                await expect(provider.send("send", {})).rejects.toThrowError(FallbackProviderError.HALTED);

                expect(provider.activeProvidersCount()).toEqual(2);
                expect(provider.isHalted()).toEqual(true);

                const newBlockNum = blockNum + 1;

                provider1.blockNumber = newBlockNum;
                provider2.blockNumber = newBlockNum;

                // Wait some time for the liveliness check to run
                await wait(LIVELINESS_PROVIDER_TIMEOUT + LIVELINESS_FALLBACK_OPTIONS.livelinessPollingInterval! + 250);

                jest.spyOn(provider1, "sendNonBlockNumberCall");
                jest.spyOn(provider2, "sendNonBlockNumberCall");

                const res = await provider.send("send", {});

                expect(provider1.sendNonBlockNumberCall).toHaveBeenCalledTimes(1);
                expect(provider2.sendNonBlockNumberCall).not.toHaveBeenCalled();
                expect(res).toEqual("1");
                expect(provider.activeProvidersCount()).toEqual(2);
                expect(provider.isHalted()).toEqual(false);
            });

            describe("block number caching", () => {
                it("should store the block number in the cache if it comes from the provider", async () => {
                    const blockNumbers = [100, 101];

                    const provider1Cache = {
                        blockNumber: null,
                    };

                    const provider2Cache = {
                        blockNumber: null,
                    };

                    const provider1GetStoredBlockNumber = jest.fn(async () => provider1Cache.blockNumber);
                    const provider1SetStoredBlockNumber = jest.fn(async (blockNumber) => {
                        provider1Cache.blockNumber = blockNumber;
                    });

                    const provider2GetStoredBlockNumber = jest.fn(async () => provider2Cache.blockNumber);
                    const provider2SetStoredBlockNumber = jest.fn(async (blockNumber) => {
                        provider2Cache.blockNumber = blockNumber;
                    });

                    const provider1 = new MockProvider("1", 1, blockNumbers[0]);
                    const provider2 = new MockProvider("2", 1, blockNumbers[1]);
                    provider = new FallbackProvider(
                        [
                            {
                                provider: provider1,
                                getStoredBlockNumber: provider1GetStoredBlockNumber,
                                setStoredBlockNumber: provider1SetStoredBlockNumber,
                            },
                            {
                                provider: provider2,
                                getStoredBlockNumber: provider2GetStoredBlockNumber,
                                setStoredBlockNumber: provider2SetStoredBlockNumber,
                            },
                        ],
                        undefined,
                        undefined,
                        undefined,
                        LIVELINESS_FALLBACK_OPTIONS,
                    );

                    // Wait some time for the liveliness check to run
                    await wait(
                        LIVELINESS_PROVIDER_TIMEOUT + LIVELINESS_FALLBACK_OPTIONS.livelinessPollingInterval! + 1000,
                    );

                    expect(provider1GetStoredBlockNumber).toHaveBeenCalled();
                    expect(provider2GetStoredBlockNumber).toHaveBeenCalled();

                    expect(provider1SetStoredBlockNumber).toHaveBeenCalledWith(blockNumbers[0]);
                    expect(provider2SetStoredBlockNumber).toHaveBeenCalledWith(blockNumbers[1]);
                });

                it("should not store the block number in the cache if it comes from the cache", async () => {
                    const blockNumbers = [100, 101];

                    const provider1Cache = {
                        blockNumber: blockNumbers[0],
                    };

                    const provider2Cache = {
                        blockNumber: blockNumbers[1],
                    };

                    const provider1GetStoredBlockNumber = jest.fn(async () => provider1Cache.blockNumber);
                    const provider1SetStoredBlockNumber = jest.fn(async (blockNumber) => {
                        provider1Cache.blockNumber = blockNumber;
                    });

                    const provider2GetStoredBlockNumber = jest.fn(async () => provider2Cache.blockNumber);
                    const provider2SetStoredBlockNumber = jest.fn(async (blockNumber) => {
                        provider2Cache.blockNumber = blockNumber;
                    });

                    const provider1 = new MockProvider("1", 1, blockNumbers[0]);
                    const provider2 = new MockProvider("2", 1, blockNumbers[1]);
                    provider = new FallbackProvider(
                        [
                            {
                                provider: provider1,
                                getStoredBlockNumber: provider1GetStoredBlockNumber,
                                setStoredBlockNumber: provider1SetStoredBlockNumber,
                            },
                            {
                                provider: provider2,
                                getStoredBlockNumber: provider2GetStoredBlockNumber,
                                setStoredBlockNumber: provider2SetStoredBlockNumber,
                            },
                        ],
                        undefined,
                        undefined,
                        undefined,
                        LIVELINESS_FALLBACK_OPTIONS,
                    );

                    // Wait some time for the liveliness check to run
                    await wait(
                        LIVELINESS_PROVIDER_TIMEOUT + LIVELINESS_FALLBACK_OPTIONS.livelinessPollingInterval! + 1000,
                    );

                    expect(provider1GetStoredBlockNumber).toHaveBeenCalled();
                    expect(provider2GetStoredBlockNumber).toHaveBeenCalled();

                    expect(provider1SetStoredBlockNumber).not.toHaveBeenCalled();
                    expect(provider2SetStoredBlockNumber).not.toHaveBeenCalled();
                });
            });
        });

        describe("Broadcast to all providers", () => {
            it("Should broadcast to all providers", async () => {
                const provider1 = new MockProvider("1");
                const provider2 = new MockProvider("2");
                provider = new FallbackProvider([provider1, provider2], undefined, undefined, undefined, {
                    broadcastToAll: true,
                });

                jest.spyOn(provider1, "sendNonBlockNumberCall");
                jest.spyOn(provider2, "sendNonBlockNumberCall");

                const res = await provider.send("eth_sendRawTransaction", {});

                expect(provider1.sendNonBlockNumberCall).toHaveBeenCalledTimes(1);
                expect(provider2.sendNonBlockNumberCall).toHaveBeenCalledTimes(1);
                expect(res).toEqual("1");
            });

            it("Should handle a failing provider", async () => {
                const provider1 = new FailingProvider("1");
                const provider2 = new MockProvider("2");
                provider = new FallbackProvider([provider1, provider2], undefined, undefined, undefined, {
                    broadcastToAll: true,
                });

                jest.spyOn(provider1, "sendNonBlockNumberCall");
                jest.spyOn(provider2, "sendNonBlockNumberCall");

                const res = await provider.send("eth_sendRawTransaction", {});

                expect(provider1.sendNonBlockNumberCall).toHaveBeenCalledTimes(1);
                expect(provider2.sendNonBlockNumberCall).toHaveBeenCalledTimes(1);
                expect(res).toEqual("2");
            });

            it("Should not be blocked by a stalling provider when one works", async () => {
                const provider1 = new StallingProvider("1");
                const provider2 = new MockProvider("2");
                provider = new FallbackProvider([provider1, provider2], undefined, undefined, undefined, {
                    broadcastToAll: true,
                });

                jest.spyOn(provider1, "sendNonBlockNumberCall");
                jest.spyOn(provider2, "sendNonBlockNumberCall");

                const res = await provider.send("eth_sendRawTransaction", {});

                expect(provider1.sendNonBlockNumberCall).not.toHaveBeenCalled();
                expect(provider2.sendNonBlockNumberCall).toHaveBeenCalledTimes(1);
                expect(res).toEqual("2");
            });

            it("Should throw an error if all providers are failing", async () => {
                const provider1 = new FailingProvider("1");
                const provider2 = new FailingProvider("2");
                provider = new FallbackProvider([provider1, provider2], undefined, undefined, undefined, {
                    broadcastToAll: true,
                });

                jest.spyOn(provider1, "sendNonBlockNumberCall");
                jest.spyOn(provider2, "sendNonBlockNumberCall");

                await expect(provider.send("eth_sendRawTransaction", {})).rejects.toThrow("Failing provider used: 1");

                expect(provider1.sendNonBlockNumberCall).toHaveBeenCalledTimes(1);
                expect(provider2.sendNonBlockNumberCall).toHaveBeenCalledTimes(1);
            });

            it("Should retry all failing providers", async () => {
                const retries = 2;

                const provider1 = new FailingProvider("1");
                const provider2 = new FailingProvider("2");
                provider = new FallbackProvider(
                    [
                        { provider: provider1, retries: retries },
                        { provider: provider2, retries: retries },
                    ],
                    undefined,
                    undefined,
                    undefined,
                    {
                        broadcastToAll: true,
                    },
                );

                jest.spyOn(provider1, "sendNonBlockNumberCall");
                jest.spyOn(provider2, "sendNonBlockNumberCall");

                await expect(provider.send("eth_sendRawTransaction", {})).rejects.toThrow("Failing provider used: 1");

                expect(provider1.sendNonBlockNumberCall).toHaveBeenCalledTimes(retries + 1);
                expect(provider2.sendNonBlockNumberCall).toHaveBeenCalledTimes(retries + 1);
            });

            it("Should only broadcast to MEV-protected providers when desired", async () => {
                const provider1 = new MockProvider("1", 1, 1);
                const provider2 = new MockProvider("2", 1, 1);
                provider = new FallbackProvider(
                    [
                        {
                            provider: provider1,
                            isMevProtected: false,
                        },
                        {
                            provider: provider2,
                            isMevProtected: true,
                        },
                    ],
                    undefined,
                    undefined,
                    undefined,
                    {
                        broadcastToAll: true,
                        broadcastOnlyToMevProtected: true,
                    },
                );

                jest.spyOn(provider1, "sendNonBlockNumberCall");
                jest.spyOn(provider2, "sendNonBlockNumberCall");

                const res = await provider.send("eth_sendRawTransaction", {});

                expect(provider1.sendNonBlockNumberCall).not.toHaveBeenCalled();
                expect(provider2.sendNonBlockNumberCall).toHaveBeenCalledTimes(1);
                expect(res).toEqual("2");
            });
        });
    });
});
