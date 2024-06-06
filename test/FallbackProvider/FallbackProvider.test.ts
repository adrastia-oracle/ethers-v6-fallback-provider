import {
    FallbackProvider,
    FallbackProviderError,
    filterValidProviders,
    getBlockNumbersAndMedian,
} from "../../src/FallbackProvider";
import FailingProvider from "./helpers/FailingProvider";
import MockProvider from "./helpers/MockProvider";
import MockWebsocketProvider from "./helpers/MockWebsocketProvider";
import StallingProvider from "./helpers/StallingProvider";

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
                FallbackProviderError.CANNOT_DETECT_NETWORKS
            );
        });

        it("should throw an error if all providers are not connected to the same network", async () => {
            const provider1 = new MockProvider("1", 1);
            const provider2 = new MockProvider("2", 2);

            await expect(filterValidProviders([provider1, provider2])).rejects.toThrowError(
                FallbackProviderError.INCONSISTENT_NETWORKS
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

    describe("getBlockNumbersAndMedian", () => {
        it("should throw an error if no provider is provided", async () => {
            await expect(getBlockNumbersAndMedian([])).rejects.toThrowError(
                FallbackProviderError.ALL_PROVIDERS_UNAVAILABLE
            );
        });

        it("should report null for stalling providers", async () => {
            const provider1 = new MockProvider("1", 1, 10);
            const provider2 = new StallingProvider("2", 1, 1);

            jest.spyOn(provider1, "send");
            jest.spyOn(provider2, "send");

            const { blockNumbers, median } = await getBlockNumbersAndMedian([provider1, provider2]);

            expect(blockNumbers).toEqual([10, null]);
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
                FallbackProviderError.ALL_PROVIDERS_UNAVAILABLE
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

            expect(blockNumbers).toEqual(underlyingBlockNumbers);
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

            expect(blockNumbers).toEqual(underlyingBlockNumbers);
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

            expect(blockNumbers).toEqual(underlyingBlockNumbers);
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

            expect(blockNumbers).toEqual(underlyingBlockNumbers);
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

            expect(blockNumbers).toEqual(underlyingBlockNumbers);
            expect(median).toEqual(101);

            expect(provider1.send).toHaveBeenCalledTimes(1);
            expect(provider2.send).toHaveBeenCalledTimes(1);
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
    });
});
