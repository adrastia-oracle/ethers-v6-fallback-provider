# ethers-v6-fallback-provider

[![npm package][npm-img]][npm-url]
[![Build Status][build-img]][build-url]
[![Downloads][downloads-img]][downloads-url]
[![Issues][issues-img]][issues-url]
[![Commitizen Friendly][commitizen-img]][commitizen-url]
[![Semantic Release][semantic-release-img]][semantic-release-url]

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
import { InfuraProvider, AlchemyProvider, getDefaultProvider } from "ethers";

import { FallbackProvider } from "@adrastia-oracle//ethers-v6-fallback-provider";

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

[build-img]: https://github.com/adrastia-oracle/ethers-v6-fallback-provider/actions/workflows/ci.yaml/badge.svg?branch=main
[build-url]: https://github.com/adrastia-oracle/ethers-v6-fallback-provider/actions/workflows/ci.yaml
[downloads-img]: https://img.shields.io/npm/dt/ethers-multicall-provider
[downloads-url]: https://www.npmtrends.com/ethers-multicall-provider
[npm-img]: https://img.shields.io/npm/v/ethers-multicall-provider
[npm-url]: https://www.npmjs.com/package/ethers-multicall-provider
[issues-img]: https://img.shields.io/github/issues/adrastia-oracle/ethers-v6-fallback-provider
[issues-url]: https://github.com/adrastia-oracle/ethers-v6-fallback-provider/issues
[codecov-img]: https://codecov.io/gh/adrastia-oracle/ethers-v6-fallback-provider/branch/main/graph/badge.svg
[codecov-url]: https://codecov.io/gh/adrastia-oracle/ethers-v6-fallback-provider
[semantic-release-img]: https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg
[semantic-release-url]: https://github.com/semantic-release/semantic-release
[commitizen-img]: https://img.shields.io/badge/commitizen-friendly-brightgreen.svg
[commitizen-url]: http://commitizen.github.io/cz-cli/
