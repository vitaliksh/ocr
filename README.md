# Local Israeli document extractor

This local Gemini-vision app extracts exactly ten document facts from JPG/PNG receipt and invoice photos: date, supplier, supplier VAT ID, invoice number, total, allocation number, purpose, transaction number, currency, and document language. It supports Hebrew, English, Russian, mixed, and other languages. It performs no accounting classification, Rivhit integration, or `MOVEIN.DAT` generation.

Run `D:\projects\ocr\run.ps1`, then open http://127.0.0.1:8010. The launcher stops a stale instance of this project's `app.py` that is listening on the selected port before starting the current code. Select one or many images. Each image is processed independently; successful results are automatically saved as `processed_documents/<image-name>.json`. Correct values in the UI and press **שמור עריכות** to save edits. Source images are unchanged.

Each JSON has one required top-level `invoices` array, even when an image contains only one document. Each invoice contains the eleven field names with a `value` and its visible `evidence`; a single source image always saves as one JSON file. `language` is a string for one language and an array for genuinely multilingual documents. Gemini instructions are read from `ocr_instructions.md` for every recognition request, so the extraction instructions can be updated without editing Python or restarting the server. `OcrProvider` is the replaceable image-analysis interface; `GeminiProvider` is its current implementation.

Choose the Gemini model in the page before recognition: `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.1-pro-preview`, or `gemini-3.5-flash-lite`. On an upstream rate-limit response (HTTP 429), the server retries up to five times. It honours Gemini's `retryDelay` when supplied and otherwise uses exponential backoff.

Use the **עצור** button to stop the current batch. The browser request is cancelled immediately, remaining files are not sent, and the server discards the response of an already-sent Gemini request when it returns.
