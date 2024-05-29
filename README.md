# ethers-v6-fallback-provider

> Package providing a fallback provider based on `ethers` package, adding more resilience.

The provider fallbacks on multiple providers in case of failure, and returns the first successful result.

It throws an error if all providers failed.

The providers are called in the order they are passed to the constructor.

Contrary to the `FallbackProvider` provided by `ethers`, this one does not use all providers at the same time, but only one at a time.
The purpose is more to have resilience if one provider fails, rather than having a resilience on the result.

## Installation

```bash
npm install @adrastia-oracle//ethers-v6-fallback-provider
```

or

```bash
yarn add @adrastia-oracle//ethers-v6-fallback-provider
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
