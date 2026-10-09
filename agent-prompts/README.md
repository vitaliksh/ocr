# Agent prompts

This directory makes the active Gemini instructions reviewable without hunting
through Worker code. `gemini-pass-1.md` is the human-readable representation of
the prompt assembled at runtime by `cloudflare-worker/src/index.js`.

Dynamic values are shown as placeholders: `{{business_activity}}`,
`{{scope}}`, `{{today}}` and `{{approved_mapping}}`. The Worker inserts them
immediately before calling Gemini. The response JSON schema and server-side validation stay
in the Worker and are part of the contract too.

There is currently one deployed AI pass (OCR). The history-based Pass 2 was
removed on 9 October 2026. The planned text-only bookkeeper agent (see
`docs/HANDOFF.md`, "Two-agent redesign") must receive its own prompt and the
field-mutation rules of `AGENTS.md` when it is added.
