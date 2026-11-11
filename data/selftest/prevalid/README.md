# Pre-validation reply fixtures

Fictional idea and fictional numbers. Format tests only.

| File | Expected parser result |
|---|---|
| reply_plain.txt | OK: scan with 6 scores, 2 competitors, no KO |
| reply_json_wrapped.json | OK, same result (transcript wrapped as JSON with escaped newlines) |
| reply_fenced.txt | OK, same result (tags inside a code fence) |
| reply_trailing_spaces.txt | OK, same result |
| reply_malformed.txt | Scan found but invalid: missing WEDGE and CONFIANCA. Show raw text, AMBER notice, do not mark the stage done |
| reply_no_tags.txt | No scan found: show the diagnostic notice and the Ask chat to reformat button |
| reply_quoted_example_only.txt | No scan found: tags inside a quoted example are ignored |
