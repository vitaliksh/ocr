# Agent prompts

This directory makes the active Gemini instructions reviewable without hunting
through Worker code. `gemini-pass-1.md` is the human-readable representation of
the prompt assembled at runtime by `cloudflare-worker/src/index.js`.

Dynamic values are shown as placeholders: `{{business_activity}}`,
`{{scope}}`, `{{today}}` and `{{approved_mapping}}`. The Worker inserts them
immediately before calling Gemini. The response JSON schema and server-side validation stay
in the Worker and are part of the contract too.

The deployed AI passes are the OCR pass (`gemini-pass-1.md`) and, from stage 4 of the two-agent plan, the text-only bookkeeper agent (`bookkeeper-agent.md`). The history-based Pass 2 was
removed on 9 October 2026. The bookkeeper agent follows the field-mutation rules
of `AGENTS.md` (see `docs/HANDOFF.md`, "Two-agent redesign").
