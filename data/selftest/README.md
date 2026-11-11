# Golden replies, one per tag kind

Fictional data, format only. Each file is a chat reply as the Drive skills define it. The self-test feeds them to the parser and the state code in a scratch store.

| File | Expected |
|---|---|
| reply_brief.txt | output kind=brief, 1 doc, 6 scores applied |
| reply_refs.txt | output kind=refs, 3 references parsed from @@REFS, 1 doc |
| reply_reveng_validation.txt | output + doc + verdict PASS WITH GAPS |
| reply_template_doc.txt | output + doc |
| reply_fulldoc.txt | output + doc |
| reply_titles.txt | output with 5 numbered titles |
| reply_titles_chosen.txt | chosen title "Soup Dash" stored and highlighted |
| reply_thumb_prompts.txt | output with 5 numbered prompts |
| reply_build_plan.txt | output + doc |
| reply_launch.txt | output only, no spend |
| reply_results.txt | output only |
| reply_gate.txt | gate PASS WITH RISKS on stage brief |
| reply_fail.txt | action returns to not started, reason shown |
