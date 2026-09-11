# Agent prompts

This directory makes the active Gemini instructions reviewable without hunting
through Worker code. `gemini-pass-1.md` is the human-readable representation of
the prompt assembled at runtime by `cloudflare-worker/src/index.js`.

Dynamic values are shown as placeholders: `{{business_activity}}`,
`{{scope}}`, and `{{approved_mapping}}`. The Worker inserts them immediately
before calling Gemini. The response JSON schema and server-side validation stay
in the Worker and are part of the contract too.

There is currently one deployed AI pass. The future text-only history pass is
not implemented and must receive its own prompt and explicit field-mutation
rules when it is added.
