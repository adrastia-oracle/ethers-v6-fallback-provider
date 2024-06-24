# Changelog

## v1.3.0 (2024-JUN-24)

-   Adds block number caching support for liveliness checks.
-   Adds logging when adding and removing active providers with liveliness checks.
-   Use retries for liveliness block number polling.

## v1.2.2 (2024-JUN-13)

-   Fix provider ID logging bug
-   Add check for active provider availability with a custom error

## v1.2.0 (2024-JUN-06)

-   Adds a mechanism to broadcast transactions to all providers if desired
-   Allow for custom IDs for each provider, to be used in logs and error messages

## v1.1.0 (2024-JUN-06)

-   Adds a mechanism to continually filter out failing providers
-   Adds a mechanism to continually filter out lagging providers (by block number)
-   Adds a mechanism to detect a halted chain and have calls throw an error
