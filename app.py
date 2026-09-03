"""Direct photo-to-Rivhit TXT converter using Gemini vision."""
from __future__ import annotations
import base64,csv,io,json,mimetypes,os,re,time,uuid,zipfile
from abc import ABC,abstractmethod
from dataclasses import dataclass
from datetime import date as Date,datetime,timedelta
from decimal import Decimal,InvalidOperation,ROUND_HALF_UP
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from threading import Event,Lock
from typing import Any
from urllib.error import HTTPError,URLError
from urllib.parse import unquote,urlsplit
from urllib.request import Request,urlopen
from xml.etree import ElementTree

ROOT=Path(__file__).parent; OUTPUT_DIR=ROOT/"processed_documents"; INSTRUCTIONS_PATH=ROOT/"ocr_instructions.md"; PKUDA_TEMPLATE_PATH=ROOT/"PKUDA_AI_TEST.TXT"; MAPPING_PATH=ROOT/"6111_to_Rivhit.xlsx"
MAX_UPLOAD_BYTES=12*1024*1024; ALLOWED_TYPES={"image/jpeg","image/png"}; ALLOWED_SUFFIXES={".jpg",".jpeg",".png"}; APP_VERSION="2026-09-01.1"; RESULT_FORMAT_VERSION=6
SUPPORTED_GEMINI_MODELS=("gemini-3.6-flash","gemini-3.5-flash","gemini-3.1-pro-preview","gemini-3.5-flash-lite"); DEFAULT_GEMINI_MODEL="gemini-3.6-flash"; MAX_RETRY_ATTEMPTS=5; MAX_RETRY_DELAY_SECONDS=60
CANCEL_EVENTS:dict[str,Event]={}; CANCEL_EVENTS_LOCK=Lock()
FIELD_NAMES=["date","supplier_name","supplier_vat_id","invoice_number","total_amount","allocation_number","purpose","transaction_number","currency"]
STRING_FIELDS=set(FIELD_NAMES)-{"total_amount"}; VALUE_SCHEMAS={**{name:{"type":"STRING","nullable":True} for name in STRING_FIELDS},"total_amount":{"type":"NUMBER","nullable":True}}
SOURCE_FIELDS_SCHEMA={name:{"type":"OBJECT","properties":{"value":VALUE_SCHEMAS[name],"evidence":{"type":"STRING","nullable":True}},"required":["value","evidence"]} for name in FIELD_NAMES}
DIRECT_INVOICE_SCHEMA={"type":"OBJECT","properties":{**SOURCE_FIELDS_SCHEMA,"document_kind":{"type":"STRING"},"requires_review":{"type":"BOOLEAN"},"form_6111_code":{"type":"STRING"},"classification_name":{"type":"STRING"},"recognized_percent":{"type":"NUMBER"},"net_amount":{"type":"NUMBER"},"vat_amount":{"type":"NUMBER"},"vat_percent":{"type":"NUMBER"},"notes":{"type":"STRING"}},"required":[*FIELD_NAMES,"document_kind","requires_review","form_6111_code","classification_name","recognized_percent","net_amount","vat_amount","vat_percent","notes"]}
DIRECT_SCHEMA={"type":"OBJECT","properties":{"invoices":{"type":"ARRAY","items":DIRECT_INVOICE_SCHEMA,"minItems":1}},"required":["invoices"]}
FOREIGN_CURRENCY_UNITS={"JPY":Decimal("100"),"LBP":Decimal("10")}

def load_dotenv()->None:
    path=ROOT/".env"
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key,value=line.split("=",1); value=value.strip().strip('"').strip("'")
                if value: os.environ[key.strip()]=value
def configured_model()->str:
    model=os.getenv("GEMINI_MODEL",DEFAULT_GEMINI_MODEL); return model if model in SUPPORTED_GEMINI_MODELS else DEFAULT_GEMINI_MODEL
def load_instructions()->str:
    try: text=INSTRUCTIONS_PATH.read_text(encoding="utf-8").strip()
    except OSError as error: raise RuntimeError("Could not read ocr_instructions.md.") from error
    if not text: raise RuntimeError("ocr_instructions.md is empty.")
    return text
def cell_column(reference:str)->int:
    value=0
    for letter in re.match(r"[A-Z]+",reference).group(0): value=value*26+ord(letter)-ord("A")+1
    return value
def load_rivhit_mapping()->dict[str,tuple[str,str]]:
    namespace="{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    try:
        with zipfile.ZipFile(MAPPING_PATH) as workbook:
            shared=ElementTree.fromstring(workbook.read("xl/sharedStrings.xml")); strings=["".join(node.text or "" for node in item.iter(f"{namespace}t")) for item in shared.findall(f"{namespace}si")]
            sheet=ElementTree.fromstring(workbook.read("xl/worksheets/sheet1.xml"))
    except (OSError,KeyError,zipfile.BadZipFile,ElementTree.ParseError) as error: raise RuntimeError("Could not read 6111_to_Rivhit.xlsx.") from error
    rows=[]
    for row in sheet.findall(f".//{namespace}sheetData/{namespace}row"):
        values={}
        for cell in row.findall(f"{namespace}c"):
            raw=cell.findtext(f"{namespace}v",default="")
            if cell.get("t")=="s" and raw: raw=strings[int(raw)]
            elif cell.get("t")=="inlineStr": raw="".join(node.text or "" for node in cell.iter(f"{namespace}t"))
            values[cell_column(cell.get("r","A1"))]=raw.strip()
        if values: rows.append(values)
    if not rows or rows[0].get(1)!="קוד מיון Rivhit" or rows[0].get(2)!="קוד 6111": raise RuntimeError("6111_to_Rivhit.xlsx must start with the Rivhit and 6111 code columns.")
    mapping={row.get(2,"").zfill(4):(row.get(1,"").zfill(3),row.get(3,"")) for row in rows[1:] if re.fullmatch(r"\d{4}",row.get(2,"")) and re.fullmatch(r"\d{3}",row.get(1,""))}
    if not mapping: raise RuntimeError("6111_to_Rivhit.xlsx contains no valid code mappings.")
    return mapping
def mapping_prompt(mapping:dict[str,tuple[str,str]])->str: return "\n".join(f"- Form 6111 {code} → Rivhit {rivhit}: {name}" for code,(rivhit,name) in mapping.items())
def retry_delay_seconds(detail:str,headers:Any,attempt:int)->float:
    try: header=float(headers.get("Retry-After")) if headers and headers.get("Retry-After") else 0
    except (TypeError,ValueError): header=0
    return min(MAX_RETRY_DELAY_SECONDS,max(2**attempt,header))
class RecognitionCancelled(Exception): pass
def cancellation_event(request_id:str)->Event:
    with CANCEL_EVENTS_LOCK: return CANCEL_EVENTS.setdefault(request_id,Event())
def release_cancellation_event(request_id:str)->None:
    with CANCEL_EVENTS_LOCK: CANCEL_EVENTS.pop(request_id,None)
class OcrProvider(ABC):
    @abstractmethod
    def recognize(self,image:bytes,mime_type:str,business_activity:str,mapping:dict[str,tuple[str,str]],cancel_event:Event|None=None)->dict[str,Any]: raise NotImplementedError
@dataclass
class GeminiProvider(OcrProvider):
    api_key:str; model:str=DEFAULT_GEMINI_MODEL
    def recognize(self,image:bytes,mime_type:str,business_activity:str,mapping:dict[str,tuple[str,str]],cancel_event:Event|None=None)->dict[str,Any]:
        prompt=f"""{load_instructions()}

Business activity: {business_activity}

You are creating the final accounting data for a Rivhit expense import directly from this image. Do all extraction and accounting decisions now; there will be no later image review. Identify each document separately if there are several. Set document_kind to exactly one of: expense_invoice, payment_confirmation, income_report, other. An income report, bank statement, customer invoice, or other income document is never an expense_invoice. A payment_confirmation is not a second expense when it documents payment of an invoice.
Select form_6111_code only from this business's configured mapping below. It must be the full four-digit Form 6111 code, not the three-digit Rivhit code. Use the image, supplier, purchased items, and business activity together. Fill every requested value with the best supported decision. For text that cannot be read use null; for accounting fields use conservative valid values and explain uncertainty in notes.
Always decide the most plausible recognized_percent from 0 to 100 based on the image, item, supplier and stated activity. requires_review is informational only: use it for an unusual or weakly evidenced decision, but never use it to avoid a decision or to set recognized_percent to 0 merely because the evidence is incomplete. For VAT, prefer printed amounts. Estimate standard Israeli VAT only for an unambiguous Israeli tax invoice. Otherwise set net_amount to gross total, vat_amount and vat_percent to 0. Ensure net_amount + vat_amount equals total_amount after cent rounding. Return only the schema response.
Allowed Form 6111 → Rivhit mapping:
{mapping_prompt(mapping)}"""
        payload={"system_instruction":{"parts":[{"text":prompt}]},"contents":[{"role":"user","parts":[{"text":"Analyze this document image and produce a final Rivhit expense record."},{"inline_data":{"mime_type":mime_type,"data":base64.b64encode(image).decode("ascii")}}]}],"generationConfig":{"responseMimeType":"application/json","responseSchema":DIRECT_SCHEMA,"temperature":0}}
        request=Request(f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent?key={self.api_key}",data=json.dumps(payload).encode(),headers={"Content-Type":"application/json"},method="POST")
        for attempt in range(MAX_RETRY_ATTEMPTS):
            if cancel_event and cancel_event.is_set(): raise RecognitionCancelled()
            try:
                with urlopen(request,timeout=90) as response: api_response=json.loads(response.read().decode())
                if cancel_event and cancel_event.is_set(): raise RecognitionCancelled()
                return json.loads(api_response["candidates"][0]["content"]["parts"][0]["text"])
            except HTTPError as error:
                detail=error.read().decode(errors="replace")
                if error.code in {429,500,502,503,504} and attempt<MAX_RETRY_ATTEMPTS-1:
                    delay=retry_delay_seconds(detail,error.headers,attempt)
                    if cancel_event and cancel_event.wait(delay): raise RecognitionCancelled()
                    continue
                raise RuntimeError(f"Gemini returned HTTP {error.code}: {detail}") from error
            except URLError as error: raise RuntimeError(f"Could not reach Gemini: {error.reason}") from error
            except (KeyError,IndexError,TypeError,json.JSONDecodeError) as error: raise RuntimeError("Gemini returned an unexpected response format.") from error
        raise RuntimeError("Gemini did not return a response after retry attempts.")

def filename(value:Any)->str:
    name=Path(str(value or "")).name
    if not name or Path(name).suffix.lower() not in ALLOWED_SUFFIXES: raise ValueError("A JPG or PNG source filename is required.")
    return name
def amount(value:Any)->float|None:
    if value is None or isinstance(value,bool): return None
    try:
        result=Decimal(str(value).replace(",","")); return float(result) if result.is_finite() else None
    except (InvalidOperation,ValueError): return None
def normalize_invoice(data:Any)->dict[str,Any]:
    if not isinstance(data,dict) or any(not isinstance(data.get(name),dict) for name in FIELD_NAMES): raise ValueError("Response must contain value and evidence for every source field.")
    values={}
    for name in FIELD_NAMES:
        value=data[name].get("value"); normalized=amount(value) if name=="total_amount" else (str(value).strip() or None if value is not None else None); evidence=str(data[name].get("evidence") or "").strip() or None
        values[name]={"value":normalized,"evidence":evidence if normalized is not None else None}
    if values["date"]["value"]:
        try: Date.fromisoformat(values["date"]["value"])
        except ValueError: values["date"]={"value":None,"evidence":None}
    return values
def money(value:Any,label:str)->Decimal:
    try: result=Decimal(str(value)).quantize(Decimal("0.01"),rounding=ROUND_HALF_UP)
    except (InvalidOperation,ValueError) as error: raise ValueError(f"Invalid {label}.") from error
    if not result.is_finite(): raise ValueError(f"Invalid {label}.")
    return result
def invoice_value(invoice:dict[str,Any],name:str)->Any: return invoice[name]["value"]
def safe_txt_value(value:Any)->str: return re.sub(r"[\t\r\n]+"," ",str(value or "")).strip()
def expense_template()->list[str]:
    try: text=PKUDA_TEMPLATE_PATH.read_bytes().decode("cp1255")
    except (OSError,UnicodeDecodeError) as error: raise ValueError("PKUDA_AI_TEST.TXT must be a Windows-1255 template in the app directory.") from error
    columns=next((line for line in re.split(r"\r?\n",text) if line),"").split("\t")
    if len(columns)!=186: raise ValueError("The first PKUDA_AI_TEST.TXT row must contain exactly 186 TAB columns.")
    return columns
def representative_rate(currency:str,invoice_date:Date)->tuple[Decimal,Date]:
    """Return the Bank of Israel representative ILS rate and the publication date."""
    if not re.fullmatch(r"[A-Z]{3}",currency): raise ValueError(f"Unsupported currency: {currency or 'missing'}.")
    start=invoice_date-timedelta(days=7)
    url=f"https://edge.boi.org.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0/RER_{currency}_ILS?startperiod={start.isoformat()}&endperiod={invoice_date.isoformat()}&format=csv"
    try:
        with urlopen(url,timeout=20) as response: rows=list(csv.DictReader(io.StringIO(response.read().decode("utf-8-sig"))))
    except (OSError,UnicodeDecodeError,csv.Error) as error: raise ValueError(f"Could not obtain the official Bank of Israel rate for {currency}.") from error
    usable=[row for row in rows if row.get("TIME_PERIOD") and row.get("OBS_VALUE")]
    if not usable: raise ValueError(f"No official Bank of Israel rate is available for {currency} on or before {invoice_date.isoformat()}.")
    selected=max(usable,key=lambda row:row["TIME_PERIOD"])
    try: return Decimal(selected["OBS_VALUE"]),Date.fromisoformat(selected["TIME_PERIOD"])
    except (InvalidOperation,ValueError) as error: raise ValueError(f"Invalid official Bank of Israel rate for {currency}.") from error
def convert_foreign_invoice(invoice:dict[str,Any],raw:dict[str,Any],warnings:list[str])->dict[str,Any]:
    currency=str(invoice_value(invoice,"currency") or "").upper()
    if currency in {"", "ILS"}: return raw
    try: invoice_date=Date.fromisoformat(str(invoice_value(invoice,"date")))
    except ValueError: raise ValueError(f"Cannot convert {currency}: document date is missing or invalid.")
    try: gross=money(invoice_value(invoice,"total_amount"),"gross amount")
    except ValueError: raise ValueError(f"Cannot convert {currency}: document total is missing or invalid.")
    rate,rate_date=representative_rate(currency,invoice_date); multiplier=rate/FOREIGN_CURRENCY_UNITS.get(currency,Decimal("1")); converted=(gross*multiplier).quantize(Decimal("0.01"),rounding=ROUND_HALF_UP)
    invoice["total_amount"]["value"]=float(converted)
    converted_raw=raw.copy()
    for name in ("net_amount","vat_amount"):
        try: converted_raw[name]=float((money(raw.get(name),name)*multiplier).quantize(Decimal("0.01"),rounding=ROUND_HALF_UP))
        except ValueError: pass
    if "net_amount" in converted_raw and "vat_amount" in converted_raw:
        try: converted_raw["vat_amount"]=float(converted-money(converted_raw["net_amount"],"net amount"))
        except ValueError: pass
    date_note="" if rate_date==invoice_date else f"; last published rate from {rate_date.isoformat()}"
    warnings.append(f"{currency} {gross:.2f} × {multiplier:.6f} → ILS {converted:.2f} (Bank of Israel{date_note})")
    return converted_raw
def default_analysis(invoice:dict[str,Any],mapping:dict[str,tuple[str,str]],raw:dict[str,Any],warnings:list[str])->dict[str,Any]:
    code=str(raw.get("form_6111_code") or "").strip()
    if code not in mapping:
        code=os.getenv("RIVHIT_FALLBACK_6111","3540"); code=code if code in mapping else next(iter(mapping)); warnings.append(f"Form 6111 code → {code} fallback")
    try:
        recognized=money(raw.get("recognized_percent"),"recognized percentage")
        if not Decimal("0")<=recognized<=Decimal("100"): raise ValueError
    except (ValueError,InvalidOperation): recognized=Decimal("0.00"); warnings.append("recognized percentage → 0.00")
    try: gross=money(invoice_value(invoice,"total_amount"),"gross amount")
    except ValueError: gross=Decimal("0.00"); warnings.append("total_amount → 0.00")
    if gross<0: gross=Decimal("0.00"); warnings.append("negative total_amount → 0.00")
    try:
        net,vat,rate=money(raw.get("net_amount"),"net amount"),money(raw.get("vat_amount"),"VAT amount"),money(raw.get("vat_percent"),"VAT percentage")
        if net<0 or vat<0 or vat>gross or not Decimal("0")<=rate<=Decimal("18") or net+vat!=gross: raise ValueError
    except ValueError: net,vat,rate=gross,Decimal("0.00"),Decimal("0.00"); recognized=Decimal("0.00"); warnings.append("VAT/net amounts → gross, 0.00, 0.00; recognized percentage → 0.00")
    return {"form_6111_code":code,"classification_name":safe_txt_value(raw.get("classification_name")) or mapping[code][1],"recognized_percent":recognized,"net_amount":net,"vat_amount":vat,"vat_percent":rate,"notes":safe_txt_value(raw.get("notes"))}
def pkuda_row(template:list[str],invoice:dict[str,Any],analysis:dict[str,Any],mapping:dict[str,tuple[str,str]],number:int,warnings:list[str])->list[str]:
    try: invoice_date=Date.fromisoformat(str(invoice_value(invoice,"date")))
    except ValueError: invoice_date=datetime.now().date(); warnings.append("date → current processing date")
    try: gross=money(invoice_value(invoice,"total_amount"),"gross amount")
    except ValueError: gross=Decimal("0.00")
    currency=str(invoice_value(invoice,"currency") or "").upper()
    if currency!="ILS": warnings.append(f"currency {currency or 'missing'}: amount copied without currency conversion")
    rivhit_code,configured_name=mapping[analysis["form_6111_code"]]; supplier,purpose=safe_txt_value(invoice_value(invoice,"supplier_name")),safe_txt_value(invoice_value(invoice,"purpose")); description=supplier or purpose or "לא זוהה"
    if not supplier and not purpose: warnings.append("description → לא זוהה")
    reference=re.sub(r"\D","",str(invoice_value(invoice,"transaction_number") or invoice_value(invoice,"invoice_number") or ""))[-4:]; allocation=re.sub(r"\D","",str(invoice_value(invoice,"allocation_number") or "")); supplier_id=re.sub(r"\D","",str(invoice_value(invoice,"supplier_vat_id") or "")) or "0"
    if supplier_id=="0": warnings.append("supplier_vat_id → 0")
    columns=template.copy(); date_text=invoice_date.strftime("%d/%m/%y"); values={1:str(invoice_date.year),2:str(invoice_date.month),3:str(number),4:rivhit_code,7:f"{gross:.2f}",8:date_text,9:date_text,10:description,11:reference,12:allocation,135:rivhit_code,136:analysis["classification_name"] or configured_name,138:f"{analysis['recognized_percent']:.2f}",155:f"{analysis['net_amount']:.2f}",156:f"{analysis['vat_amount']:.2f}",158:f"{analysis['vat_percent']:.2f}",164:f"{gross:.2f}",178:supplier_id,185:str(invoice_date.year),186:str(invoice_date.month)}
    for column,value in values.items(): columns[column-1]=value
    if len(columns)!=186 or any(any(char in value for char in "\t\r\n") for value in columns): raise ValueError("Could not build a valid 186-column TXT row.")
    return columns
def direct_records(data:Any,mapping:dict[str,tuple[str,str]],first_number:int)->list[dict[str,Any]]:
    if not isinstance(data,dict) or not isinstance(data.get("invoices"),list) or not data["invoices"]: raise ValueError("Gemini response has no invoices.")
    template=expense_template(); records=[]
    for offset,raw in enumerate(data["invoices"]):
        invoice=normalize_invoice(raw); warnings=[]; kind=str(raw.get("document_kind") or "").strip()
        if kind in {"income_report", "other"}:
            records.append({"invoice":invoice,"document_kind":kind,"skipped":True,"reason":"Income or non-expense document: excluded from the Rivhit expense TXT.","warnings":[safe_txt_value(raw.get("notes"))] if safe_txt_value(raw.get("notes")) else []})
            continue
        converted_raw=convert_foreign_invoice(invoice,raw,warnings); analysis=default_analysis(invoice,mapping,converted_raw,warnings)
        if raw.get("requires_review") is True: warnings.append("Best-effort accounting decision; review note retained")
        row=pkuda_row(template,invoice,analysis,mapping,first_number+offset,warnings)
        if analysis["notes"]: warnings.append(analysis["notes"])
        records.append({"invoice":invoice,"document_kind":kind if kind in {"expense_invoice","payment_confirmation"} else "expense_invoice","requires_review":raw.get("requires_review") is True,"form_6111_code":analysis["form_6111_code"],"rivhit_code":row[3],"classification_name":row[135],"recognized_percent":row[137],"net_amount":row[154],"vat_amount":row[155],"vat_percent":row[157],"warnings":warnings,"row":row})
    return records
def valid_business_activity(value:Any)->str:
    text=safe_txt_value(value)
    if not text: raise ValueError("Business activity is required.")
    if len(text)>500: raise ValueError("Business activity is too long.")
    return text
def export_rows(raw_rows:Any)->dict[str,Any]:
    if not isinstance(raw_rows,list) or not raw_rows: raise ValueError("No Rivhit rows were supplied for export.")
    rows=[]
    for number,raw in enumerate(raw_rows,1):
        if not isinstance(raw,list) or len(raw)!=186 or any(not isinstance(value,str) or any(char in value for char in "\t\r\n") for value in raw): raise ValueError("Invalid Rivhit row received from the browser.")
        if raw[3]!=raw[134] or not re.fullmatch(r"\d{3}",raw[3]): raise ValueError("Invalid Rivhit classification code in an output row.")
        row=raw.copy(); row[2]=str(number); rows.append(row)
    OUTPUT_DIR.mkdir(exist_ok=True); output=OUTPUT_DIR/f"PKUDA_{datetime.now():%Y%m%d_%H%M%S}_{uuid.uuid4().hex[:6]}.TXT"; output.write_bytes("\r\n".join("\t".join(row) for row in rows).encode("cp1255",errors="strict"))
    return {"output":output.name,"exported":len(rows),"download":f"/api/download/{output.name}"}

class AppHandler(BaseHTTPRequestHandler):
    def do_POST(self)->None:
        route=urlsplit(self.path).path
        if route=="/api/recognize-rivhit": self.recognize_rivhit()
        elif route=="/api/export-rivhit": self.export_rivhit()
        elif route=="/api/cancel": self.cancel_recognition()
        else: self.send_error(HTTPStatus.NOT_FOUND)
    def cancel_recognition(self)->None:
        request_id=self.headers.get("X-Request-ID","")
        if not request_id: self.respond(HTTPStatus.BAD_REQUEST,{"error":"Missing request ID."}); return
        cancellation_event(request_id).set(); self.respond(HTTPStatus.OK,{"cancelled":True})
    def recognize_rivhit(self)->None:
        load_dotenv(); request_id=self.headers.get("X-Request-ID") or uuid.uuid4().hex; cancel_event=cancellation_event(request_id)
        try:
            length,source=int(self.headers.get("Content-Length","0")),filename(self.headers.get("X-Source-Filename")); activity=valid_business_activity(unquote(self.headers.get("X-Business-Activity", ""))); mime=self.headers.get("Content-Type","").split(";",1)[0].lower()
            if not length or length>MAX_UPLOAD_BYTES: raise ValueError("Image must be 12 MB or smaller.")
            if mime not in ALLOWED_TYPES: raise ValueError("Only JPG and PNG images are supported.")
            image=self.rfile.read(length)
            if len(image)!=length: raise ValueError("Image upload was incomplete.")
            key=os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
            if not key: self.respond(HTTPStatus.SERVICE_UNAVAILABLE,{"error":"Set GEMINI_API_KEY in .env or your environment."}); return
            selected_model=self.headers.get("X-Gemini-Model",configured_model())
            if selected_model not in SUPPORTED_GEMINI_MODELS: raise ValueError("Unsupported Gemini model.")
            mapping=load_rivhit_mapping(); response=GeminiProvider(key,selected_model).recognize(image,mime,activity,mapping,cancel_event)
            if cancel_event.is_set(): raise RecognitionCancelled()
            self.respond(HTTPStatus.OK,{"source":source,"records":direct_records(response,mapping,int(self.headers.get("X-First-Row","1")))})
        except RecognitionCancelled: self.respond(HTTPStatus.CONFLICT,{"error":"Recognition cancelled."})
        except (RuntimeError,ValueError) as error: self.respond(HTTPStatus.BAD_GATEWAY,{"error":str(error)})
        finally: release_cancellation_event(request_id)
    def export_rivhit(self)->None:
        try:
            length=int(self.headers.get("Content-Length","0"))
            if not length or length>5*1024*1024: raise ValueError("Invalid export request.")
            payload=json.loads(self.rfile.read(length).decode("utf-8")); self.respond(HTTPStatus.OK,export_rows(payload.get("rows")))
        except (ValueError,UnicodeDecodeError,json.JSONDecodeError) as error: self.respond(HTTPStatus.BAD_REQUEST,{"error":str(error)})
        except OSError: self.respond(HTTPStatus.INTERNAL_SERVER_ERROR,{"error":"Could not write the Rivhit TXT file."})
    def do_GET(self)->None:
        route=urlsplit(self.path).path
        if route=="/api/health":
            load_dotenv()
            try: mapping_count,mapping_error=len(load_rivhit_mapping()),None
            except RuntimeError as error: mapping_count,mapping_error=0,str(error)
            self.respond(HTTPStatus.OK,{"version":APP_VERSION,"result_format_version":RESULT_FORMAT_VERSION,"gemini_key_configured":bool(os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")),"model":configured_model(),"models":SUPPORTED_GEMINI_MODELS,"mapping_entries":mapping_count,"mapping_error":mapping_error}); return
        if route.startswith("/api/download/"): self.download(route.removeprefix("/api/download/")); return
        relative="index.html" if route in {"","/"} else route.lstrip("/"); root=(ROOT/"web").resolve(); path=(ROOT/"web"/relative).resolve()
        if root not in path.parents or not path.is_file(): self.send_error(HTTPStatus.NOT_FOUND,"File not found."); return
        data=path.read_bytes(); mime=mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        if mime.startswith("text/") or mime in {"application/javascript","application/json"}: mime+="; charset=utf-8"
        self.send_response(HTTPStatus.OK); self.send_header("Content-Type",mime); self.send_header("Cache-Control","no-store"); self.send_header("Content-Length",str(len(data))); self.end_headers(); self.wfile.write(data)
    def download(self,name:str)->None:
        path=(OUTPUT_DIR/Path(unquote(name)).name).resolve()
        if OUTPUT_DIR.resolve() not in path.parents or not path.is_file() or path.suffix.upper()!=".TXT": self.send_error(HTTPStatus.NOT_FOUND,"TXT file not found."); return
        data=path.read_bytes(); self.send_response(HTTPStatus.OK); self.send_header("Content-Type","text/plain; charset=windows-1255"); self.send_header("Content-Disposition",f'attachment; filename="{path.name}"'); self.send_header("Content-Length",str(len(data))); self.end_headers(); self.wfile.write(data)
    def respond(self,status:HTTPStatus,payload:dict[str,Any])->None:
        body=json.dumps(payload,ensure_ascii=False).encode("utf-8"); self.send_response(status); self.send_header("Content-Type","application/json; charset=utf-8"); self.send_header("Cache-Control","no-store"); self.send_header("X-Result-Format-Version",str(RESULT_FORMAT_VERSION)); self.send_header("Content-Length",str(len(body))); self.end_headers(); self.wfile.write(body)
def main()->None:
    load_dotenv(); port=int(os.getenv("PORT","8010")); pid_file=ROOT/f".server-{port}.pid"; server=ThreadingHTTPServer(("127.0.0.1",port),AppHandler); pid_file.write_text(str(os.getpid()),encoding="ascii"); print(f"Direct Rivhit converter {APP_VERSION} running from {ROOT}"); print(f"Open http://127.0.0.1:{port}")
    try: server.serve_forever()
    except KeyboardInterrupt: print("\nStopped.")
    finally:
        if pid_file.exists() and pid_file.read_text(encoding="ascii").strip()==str(os.getpid()): pid_file.unlink()
if __name__=="__main__": main()
