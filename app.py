"""Local Israeli invoice/receipt extraction with Gemini vision."""
from __future__ import annotations
import base64, json, mimetypes, os, re, time, uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import date as Date
from decimal import Decimal, InvalidOperation
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Event, Lock
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).parent
OUTPUT_DIR = ROOT / "processed_documents"
OCR_INSTRUCTIONS_PATH = ROOT / "ocr_instructions.md"
MAX_UPLOAD_BYTES = 12 * 1024 * 1024
ALLOWED_TYPES = {"image/jpeg", "image/png"}
ALLOWED_SUFFIXES = {".jpg", ".jpeg", ".png"}
APP_VERSION = "2026-08-29.3"
RESULT_FORMAT_VERSION = 4
SUPPORTED_GEMINI_MODELS = ("gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.1-pro-preview", "gemini-3.5-flash-lite")
DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite"
MAX_RETRY_ATTEMPTS = 5
MAX_RETRY_DELAY_SECONDS = 60
CANCEL_EVENTS: dict[str, Event] = {}
CANCEL_EVENTS_LOCK = Lock()
FIELD_NAMES = ["recipient_name", "date", "supplier_name", "supplier_vat_id", "invoice_number", "total_amount", "allocation_number", "purpose", "transaction_number", "currency", "language"]
STRING_FIELDS = set(FIELD_NAMES) - {"total_amount", "language"}
VALUE_SCHEMAS = {**{name: {"type": "STRING", "nullable": True} for name in STRING_FIELDS}, "total_amount": {"type": "NUMBER", "nullable": True}, "language": {"anyOf": [{"type": "STRING"}, {"type": "ARRAY", "items": {"type": "STRING"}}], "nullable": True}}
INVOICE_SCHEMA: dict[str, Any] = {"type": "OBJECT", "properties": {
    name: {"type": "OBJECT", "properties": {"value": VALUE_SCHEMAS[name], "evidence": {"type": "STRING", "nullable": True}}, "required": ["value", "evidence"]}
    for name in FIELD_NAMES
}, "required": FIELD_NAMES}
SCHEMA: dict[str, Any] = {"type": "OBJECT", "properties": {"invoices": {"type": "ARRAY", "items": INVOICE_SCHEMA, "minItems": 1}}, "required": ["invoices"]}

def load_dotenv() -> None:
    path = ROOT / ".env"
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, value = line.split("=", 1); value = value.strip().strip('"').strip("'")
                if value: os.environ[key.strip()] = value

def load_ocr_instructions() -> str:
    """Load the user-maintained Gemini instruction file for every request."""
    try:
        instructions = OCR_INSTRUCTIONS_PATH.read_text(encoding="utf-8").strip()
    except OSError as error:
        raise RuntimeError("Could not read ocr_instructions.md.") from error
    if not instructions:
        raise RuntimeError("ocr_instructions.md is empty.")
    return instructions

def configured_model() -> str:
    model = os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)
    return model if model in SUPPORTED_GEMINI_MODELS else DEFAULT_GEMINI_MODEL

def parse_retry_delay(value: Any) -> float | None:
    """Parse Google RetryInfo durations such as '7s' or '250ms'."""
    if not isinstance(value, str): return None
    match = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*(ms|s)\s*", value)
    if not match: return None
    delay = float(match.group(1))
    return delay / 1000 if match.group(2) == "ms" else delay

def retry_delay_seconds(detail: str, headers: Any, attempt: int) -> float:
    """Use Gemini's retryDelay when supplied; otherwise exponential backoff."""
    exponential_delay = min(MAX_RETRY_DELAY_SECONDS, 2 ** attempt)
    retry_after = headers.get("Retry-After") if headers else None
    try: header_delay = float(retry_after) if retry_after is not None else None
    except (TypeError, ValueError): header_delay = None
    try: details = json.loads(detail).get("error", {}).get("details", [])
    except json.JSONDecodeError: details = []
    retry_info_delay = next((parse_retry_delay(item.get("retryDelay")) for item in details if isinstance(item, dict) and parse_retry_delay(item.get("retryDelay")) is not None), None)
    return min(MAX_RETRY_DELAY_SECONDS, max(exponential_delay, header_delay or 0, retry_info_delay or 0))

class RecognitionCancelled(Exception): pass

def cancellation_event(request_id: str) -> Event:
    with CANCEL_EVENTS_LOCK: return CANCEL_EVENTS.setdefault(request_id, Event())

def release_cancellation_event(request_id: str) -> None:
    with CANCEL_EVENTS_LOCK: CANCEL_EVENTS.pop(request_id, None)

class OcrProvider(ABC):
    @abstractmethod
    def recognize(self, image: bytes, mime_type: str) -> dict[str, Any]: raise NotImplementedError

@dataclass
class GeminiProvider(OcrProvider):
    api_key: str
    model: str = DEFAULT_GEMINI_MODEL
    def recognize(self, image: bytes, mime_type: str, cancel_event: Event | None = None) -> dict[str, Any]:
        payload = {"system_instruction": {"parts": [{"text": load_ocr_instructions()}]}, "contents": [{"role": "user", "parts": [{"text": "Analyze this document image according to the supplied instructions."}, {"inline_data": {"mime_type": mime_type, "data": base64.b64encode(image).decode("ascii")}}]}], "generationConfig": {"responseMimeType": "application/json", "responseSchema": SCHEMA, "temperature": 0}}
        request = Request(f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent?key={self.api_key}", data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"}, method="POST")
        for attempt in range(MAX_RETRY_ATTEMPTS):
            if cancel_event and cancel_event.is_set(): raise RecognitionCancelled()
            try:
                with urlopen(request, timeout=90) as response: api_response = json.loads(response.read().decode())
                if cancel_event and cancel_event.is_set(): raise RecognitionCancelled()
                return json.loads(api_response["candidates"][0]["content"]["parts"][0]["text"])
            except HTTPError as error:
                detail = error.read().decode(errors="replace")
                if error.code in {429, 500, 502, 503, 504} and attempt < MAX_RETRY_ATTEMPTS - 1:
                    delay = retry_delay_seconds(detail, error.headers, attempt)
                    if cancel_event and cancel_event.wait(delay): raise RecognitionCancelled()
                    time.sleep(delay) if not cancel_event else None
                    continue
                raise RuntimeError(f"Gemini returned HTTP {error.code}: {detail}") from error
            except URLError as error: raise RuntimeError(f"Could not reach Gemini: {error.reason}") from error
            except (KeyError, IndexError, TypeError, json.JSONDecodeError) as error: raise RuntimeError("Gemini returned an unexpected response format.") from error
        raise RuntimeError("Gemini did not return a response after retry attempts.")

def filename(value: Any) -> str:
    name = Path(str(value or "")).name
    if not name or Path(name).suffix.lower() not in ALLOWED_SUFFIXES: raise ValueError("A JPG or PNG source filename is required.")
    return name
def amount(value: Any) -> float | None:
    if value is None or isinstance(value, bool): return None
    try:
        value = Decimal(str(value).replace(",", "")); return float(value) if value.is_finite() else None
    except (InvalidOperation, ValueError): return None
def language(value: Any) -> str | list[str] | None:
    values = value if isinstance(value, list) else [value]
    cleaned = [str(item).strip().lower() for item in values if str(item).strip()] if value is not None else []
    if not cleaned or any(not re.fullmatch(r"[a-z]{2,3}", item) for item in cleaned): return None
    return cleaned[0] if len(cleaned) == 1 else cleaned
def normalize_invoice(data: Any) -> dict[str, Any]:
    if not isinstance(data, dict) or any(not isinstance(data.get(name), dict) for name in FIELD_NAMES): raise ValueError("Response must contain a value and evidence object for every field.")
    fields, evidence = {}, {}
    for name in FIELD_NAMES:
        value = data[name].get("value")
        fields[name] = amount(value) if name == "total_amount" else language(value) if name == "language" else (str(value).strip() or None if value is not None else None)
        ev = data[name].get("evidence"); evidence[name] = str(ev).strip() or None if ev is not None else None
        if fields[name] is None: evidence[name] = None
    if fields["date"]:
        try: Date.fromisoformat(fields["date"])
        except ValueError: fields["date"] = evidence["date"] = None
    return {name: {"value": fields[name], "evidence": evidence[name]} for name in FIELD_NAMES}
def normalize(data: Any) -> dict[str, Any]:
    if not isinstance(data, dict) or not isinstance(data.get("invoices"), list) or not data["invoices"]:
        raise ValueError("Response must contain a non-empty invoices array.")
    return {"invoices": [normalize_invoice(invoice) for invoice in data["invoices"]]}
def save(document: dict[str, Any], source_image: str) -> None:
    OUTPUT_DIR.mkdir(exist_ok=True)
    (OUTPUT_DIR / f"{Path(filename(source_image)).stem}.json").write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

class AppHandler(BaseHTTPRequestHandler):
    def do_POST(self) -> None: # noqa: N802
        if urlsplit(self.path).path == "/api/recognize": self.recognize()
        elif urlsplit(self.path).path == "/api/save": self.save_edited()
        elif urlsplit(self.path).path == "/api/cancel": self.cancel_recognition()
        else: self.send_error(HTTPStatus.NOT_FOUND)
    def cancel_recognition(self) -> None:
        request_id = self.headers.get("X-Request-ID", "")
        if not request_id: self.respond(HTTPStatus.BAD_REQUEST, {"error": "Missing request ID."}); return
        cancellation_event(request_id).set()
        self.respond(HTTPStatus.OK, {"cancelled": True})
    def recognize(self) -> None:
        load_dotenv()
        request_id = self.headers.get("X-Request-ID") or uuid.uuid4().hex
        cancel_event = cancellation_event(request_id)
        try: length, source = int(self.headers.get("Content-Length", "0")), filename(self.headers.get("X-Source-Filename"))
        except ValueError as error: self.respond(HTTPStatus.BAD_REQUEST, {"error": str(error)}); return
        mime = self.headers.get("Content-Type", "").split(";", 1)[0].lower()
        if not length or length > MAX_UPLOAD_BYTES: self.respond(HTTPStatus.BAD_REQUEST, {"error": "Image must be 12 MB or smaller."}); return
        if mime not in ALLOWED_TYPES: self.respond(HTTPStatus.BAD_REQUEST, {"error": "Only JPG and PNG images are supported."}); return
        image = self.rfile.read(length)
        if len(image) != length: self.respond(HTTPStatus.BAD_REQUEST, {"error": "Image upload was incomplete."}); return
        key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        if not key: self.respond(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "Set GEMINI_API_KEY in .env or your environment."}); return
        try:
            if cancel_event.is_set(): raise RecognitionCancelled()
            requested_model = self.headers.get("X-Gemini-Model", configured_model())
            if requested_model not in SUPPORTED_GEMINI_MODELS: raise ValueError("Unsupported Gemini model.")
            document = normalize(GeminiProvider(key, requested_model).recognize(image, mime, cancel_event))
            if cancel_event.is_set(): raise RecognitionCancelled()
            save(document, source); self.respond(HTTPStatus.OK, document)
        except RecognitionCancelled:
            self.respond(HTTPStatus.CONFLICT, {"error": "Recognition cancelled."})
        except (RuntimeError, ValueError) as error: self.respond(HTTPStatus.BAD_GATEWAY, {"error": str(error)})
        except OSError: self.respond(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "Could not save the result JSON."})
        finally: release_cancellation_event(request_id)
    def save_edited(self) -> None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not length or length > 1024 * 1024: raise ValueError("Invalid save request.")
            source = filename(self.headers.get("X-Source-Filename")); raw = json.loads(self.rfile.read(length).decode()); document = normalize(raw); save(document, source); self.respond(HTTPStatus.OK, document)
        except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as error: self.respond(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        except OSError: self.respond(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "Could not save the result JSON."})
    def do_GET(self) -> None: # noqa: N802
        route = urlsplit(self.path).path
        if route == "/api/health":
            load_dotenv(); self.respond(HTTPStatus.OK, {"version": APP_VERSION, "result_format_version": RESULT_FORMAT_VERSION, "gemini_key_configured": bool(os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")), "model": configured_model(), "models": SUPPORTED_GEMINI_MODELS, "output_directory": OUTPUT_DIR.name}); return
        relative = "index.html" if route in {"", "/"} else route.lstrip("/"); root = (ROOT / "web").resolve(); path = (root / relative).resolve()
        if root not in path.parents or not path.is_file(): self.send_error(HTTPStatus.NOT_FOUND, "File not found."); return
        data = path.read_bytes(); mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        if mime.startswith("text/") or mime in {"application/javascript", "application/json"}: mime += "; charset=utf-8"
        self.send_response(HTTPStatus.OK); self.send_header("Content-Type", mime); self.send_header("Cache-Control", "no-store"); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
    def respond(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode(); self.send_response(status); self.send_header("Content-Type", "application/json; charset=utf-8"); self.send_header("Cache-Control", "no-store"); self.send_header("X-Result-Format-Version", str(RESULT_FORMAT_VERSION)); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)

def main() -> None:
    load_dotenv(); port = int(os.getenv("PORT", "8010")); pid_file = ROOT / f".server-{port}.pid"; server = ThreadingHTTPServer(("127.0.0.1", port), AppHandler); pid_file.write_text(str(os.getpid()), encoding="ascii"); print(f"Document extractor {APP_VERSION} running from {ROOT}"); print(f"Open http://127.0.0.1:{port}")
    try: server.serve_forever()
    except KeyboardInterrupt: print("\nStopped.")
    finally:
        if pid_file.exists() and pid_file.read_text(encoding="ascii").strip() == str(os.getpid()): pid_file.unlink()
if __name__ == "__main__": main()
