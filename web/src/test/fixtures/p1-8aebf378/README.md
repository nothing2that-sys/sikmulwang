# Frozen P1 compatibility fixture

Source commit: `8aebf378492ac95118eb7e6096769fa8b39e27f0` in nothing2that-sys/sikmulwang. The seven TypeScript files are exact source copies from `web/src/lib/db/` with LF line endings. The DB modules are identical to the P1 Production source `21f4bcd1e9853daabadba71daa4a899dfcefed2e`.

Do not update these files to match current implementation. They intentionally retain P1's strict writer version 1 and original purge path. `SHA256.json` records LF-normalized bytes; the regression verifies the manifest. This is actual legacy code, not a reimplementation of the current guard.

Unit tests open it against the same isolated IndexedDB as the current writer. Chromium tests bundle it in memory into a test-only page sharing the test application's origin. The product does not import this fixture; no legacy script is published in the application bundle.

The sibling `p2-608da74-state.json` is a synthetic database fixture generated using the independently compiled, unmodified `608da74` modules. It contains two historical rule versions, five decision logs, WATERED/MOIST/undo history, and legacy prefix snapshot IDs. It contains no real user records. Tests separately add a Blob and compare original rows/bytes before and after transition or rollback.
