# Frozen P2 writer fixtures

Source: `9df3ef23cbcf108cc701c2ff6282a06d13b71012:web/src/lib/db/`.

Eight actual source files, LF-normalized. Only writerCompatibility.ts relative care/engine import is relocated to the unchanged product engine. SOURCE_SHA256.json records original Git bytes after LF normalization; SHA256.json records runnable fixture bytes. The test verifies both by reversing that one import relocation. Product care engine and P2 rule/repository golden files are unchanged from the base commit. Browser fixtures bundle these same files in memory, outside the product build.

Never rewrite this fixture to make a new writer appear compatible. The unsafe purge counterexample intentionally succeeds in an isolated synthetic DB, then the tests prove that P3 metadata 3 rejects this actual writer.
