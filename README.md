# ethers-v6-fallback-provider

> Package providing a fallback provider based on `ethers` package, adding more resilience.

The provider fallbacks on multiple providers in case of failure, and returns the first successful result.

It throws an error if all providers failed.

The providers are called in the order they are passed to the constructor.

Contrary to the `FallbackProvider` provided by `ethers`, this one does not use all providers at the same time, but only one at a time.
The purpose is more to have resilience if one provider fails, rather than having a resilience on the result.

## Installation

```bash
npm install @adrastia-oracle/ethers-v6-fallback-provider
```

or

```bash
yarn add @adrastia-oracle/ethers-v6-fallback-provider
```

## Usage

```typescript
import { FallbackProvider } from "@adrastia-oracle//ethers-v6-fallback-provider";
import { InfuraProvider, AlchemyProvider, getDefaultProvider } from "ethers";

const timeout = 1000; // 1 second, optionnal, default is 3000ms

const provider = new FallbackProvider([
    {
        provider: new InfuraProvider("mainnet", "your-api-key"),
        retries: 3, // retry after a timeout or an error 3 times, default is 0.
        timeout,
        retryDelay: 1000, // wait a random time less than 1 second before retrying. Default is 0.
    },
    new AlchemyProvider("mainnet", "your-api-key"),
    getDefaultProvider("mainnet"),
]);

// You can now use the fallback provider as a classic provider
const blockNumber = await provider.getBlockNumber();
```

### Provider capabilities

Each provider can declare which JSON-RPC methods it is able to serve. Use `supportedMethods` to restrict a provider to an
explicit list of methods, and `unsupportedMethods` to exclude specific methods. Providers that cannot serve the requested
method are skipped entirely.

```typescript
const provider = new FallbackProvider([
    {
        // A specialized endpoint that can only serve receipts.
        provider: new JsonRpcProvider("https://receipts.example.com"),
        supportedMethods: ["eth_getTransactionReceipt"],
    },
    {
        // A general-purpose endpoint that serves everything except transaction broadcasting.
        provider: new JsonRpcProvider("https://archive.example.com"),
        unsupportedMethods: ["eth_sendRawTransaction"],
    },
    {
        provider: getDefaultProvider("mainnet"),
    },
]);
```

Notes:

- Method names are matched exactly. Wildcards and patterns are not supported.
- `unsupportedMethods` takes precedence over `supportedMethods`.
- Every provider is assumed to support `eth_chainId` and `eth_blockNumber`. These methods are always served, even if they
  are omitted from `supportedMethods` or listed in `unsupportedMethods`, because network detection and liveliness checks
  depend on them.
- Capabilities do not affect liveliness checks: a restricted provider still contributes to the block number median and
  can still be marked as active.
- If no provider supports the requested method, the call throws `All providers are unavailable`. The thrown error carries
  an `unsupportedMethod` property naming the method.

> **Caveat:** ethers' high-level APIs and event polling issue methods you may not anticipate, such as
> `eth_getBlockByNumber`, `eth_getLogs`, `eth_call`, `eth_estimateGas`, and `eth_getTransactionCount`. An overly narrow
> `supportedMethods` list applied to _all_ of your providers will make those calls fail. Restrict individual providers
> and keep at least one general-purpose provider in the list.
