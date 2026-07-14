# Sync regression tests

Run with plain Node (no dependencies):

    node tests/test-supabase-sync.js     # settings/config sync (supabase-client.js, loaded for real with stubbed browser APIs)
    node tests/test-sheet-pipeline.js    # sheet fetch/merge pipeline (functions extracted verbatim from script.js)

Both exit non-zero on failure. Covers: resilient settings upsert (unknown-column
retry), PAT never uploaded / cleared on sign-out, cloud config pull, URL parsing,
gviz row conversion, header keyword matching + realignment (incl. the wrong-header-row
failure mode), multi-sheet merge with partial failures, CSV parsing, config loading.
