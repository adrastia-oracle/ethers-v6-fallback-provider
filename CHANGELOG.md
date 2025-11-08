# Changelog

## v1.7.2 (2025-NOV-07)

- Only compute tx hash when absolutely necessary (when catching "already known" errors) to avoid unnecessary computation

## v1.7.1 (2025-JUL-23)

- Remove logging of "already known" errors when broadcasting to all providers: these errors are expected and common in that case, so logging them is unnecessary.

## v1.7.0 (2025-JUL-22)

- When sending a transaction, if an underlying provider returns an "already known" error, the transaction hash will be returned instead of throwing an error.

## v1.6.0 (2025-MAR-24)

- If any timed out promises have resolved, the first (in the order calls were sent) value will be returned
- If any timed out promises have been rejected upon an exception (rejection or timeout), return the first (...) rejection
- If any timed out promises resolve when broadcasting to all providers, the broadcast will stop and the first (...) resolved value will be returned

## v1.5.6 (2025-JAN-21)

- Upgrade ethers to v6.13.5

## v1.5.5 (2025-JAN-08)

- Add catch-all to classify all errors without revert data as non-blockchain errors so that we try the next provider if available

## v1.5.4 (2024-DEC-15)

- Recognize "height must be greater than zero" and "missing trie node" errors as server errors

## v1.5.3 (2024-DEC-14)

- Recognize "header not found" and "Unable to perform request" errors as server errors

## v1.5.2 (2024-DEC-11)

- Correctly identify some specific server errors as such
    - If throwOnFirstBlockchainError is true, it will not immediately throw errors such as 'intrinsic gas too low', 'evm module does not exist on height'
- Properly set the default throwOnFirstBlockchainError
    - This is just semantics; functionally, it was already set to true by default

## v1.5.1 (2024-OCT-14)

- Upgrades ethers to v6.13.4

## v1.5.0 (2024-OCT-14)

- Adds functionality to throw the first blockchain error rather than retrying with the next provider (enabled by default).
- Attaches the provider ID list to error objects.
- Improves error logging.
- Upgrades ethers to v6.13.3 and upgrades various dev dependencies.

## v1.4.0 (2024-AUG-14)

- Adds the ability to only broadcast a transaction to MEV-protected providers.

## v1.3.0 (2024-JUN-24)

- Adds block number caching support for liveliness checks.
- Adds logging when adding and removing active providers with liveliness checks.
- Use retries for liveliness block number polling.

## v1.2.2 (2024-JUN-13)

- Fix provider ID logging bug
- Add check for active provider availability with a custom error

## v1.2.0 (2024-JUN-06)

- Adds a mechanism to broadcast transactions to all providers if desired
- Allow for custom IDs for each provider, to be used in logs and error messages

## v1.1.0 (2024-JUN-06)

- Adds a mechanism to continually filter out failing providers
- Adds a mechanism to continually filter out lagging providers (by block number)
- Adds a mechanism to detect a halted chain and have calls throw an error
