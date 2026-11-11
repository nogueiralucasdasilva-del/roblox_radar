# Synthetic fixtures

SYNTHETIC data generated for tests. It is not from any real game video. Never present it as real.

| Folder | What it is | Expected result with `validate_extraction.py` |
|---|---|---|
| `synthetic_good` | 6 chunks, 60 minutes, economy, onboarding, prices | PASS WITH GAPS (two placeholder fields are removed on purpose) |
| `synthetic_esc` | Same data with Markdown escapes and a code fence, as a Google Doc export would produce | PASS WITH GAPS (proves the lenient loader) |
| `synthetic_short` | 2 chunks only | FAIL (coverage) |
| `synthetic_bad` | 6 chunks with unreadable numbers | FAIL (readability) |

Run: `python3 -I seed/reveng/validate_extraction.py tests/fixtures/synthetic_good/chunk_*.json --out-dir /tmp/out`
