"""
uploader.py — RIPCON Audiovisual Uploader v3
=============================================
Integración completa del notebook ripcon_av_uploader dentro del backend Azure Functions.

Mejoras sobre uploader.py v1/v2:
  - TokenPool: reutiliza token Graph, renueva solo cuando expira (thread-safe)
  - Blob index único: 1 op de lista en lugar de N ops de blob.exists()
  - Descarga a tempfile con chunks (videos 4K, archivos >500 MB)
  - Separación livianos vs pesados con concurrencias distintas
  - Reintentos exponenciales con Retry-After para throttling de Graph
  - Renombrado inteligente: PREFIJO_YYYYMMDD_NNN.ext según fecha inferida
  - upload_from_sharepoint / upload_from_onedrive nativos (por folder path)
  - Resolución de URL SharePoint a site_id + folder_path
  - upload_urls_with_progress mantiene interfaz original para function_app.py
  - Estadísticas de throughput por archivo

Convención de nombres en Blob:
  Container : audiovisual
  Proyecto  : CODIGO_nombre-corto  (ej. 28002_confluencia-puembo)
  Semana    : YYYY_S##             (ej. 2026_S15)
  Archivo   : PREFIJO_YYYYMMDD_NNN.ext
"""

from __future__ import annotations

import base64
import logging
import mimetypes
import os
import re
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

import msal
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from azure.core.exceptions import ResourceExistsError
from azure.storage.blob import (
    BlobServiceClient,
    ContentSettings,
    StandardBlobTier,
)

log = logging.getLogger("uploader")

# ── Configuración ────────────────────────────────────────────────────────────

GRAPH_BASE = "https://graph.microsoft.com/v1.0"
GRAPH_SCOPE = ["https://graph.microsoft.com/.default"]
GRAPH_CONNECT_TIMEOUT = 15
GRAPH_READ_TIMEOUT = 120
GRAPH_DOWNLOAD_READ_TIMEOUT = 300
GRAPH_DOWNLOAD_RETRIES = 3
GRAPH_MAX_RETRIES = 5
GRAPH_RETRY_BACKOFF = 2
GRAPH_MAX_CONCURRENT = 12
GRAPH_HTTP_POOL_SIZE = 32
TOKEN_TTL_SECONDS = 3000  # tokens duran 3600s, se renuevan con margen

CHUNK_SIZE = 32 * 1024 * 1024          # 32 MB streaming chunks
GRAPH_DOWNLOAD_CHUNK = 16 * 1024 * 1024
DOWNLOAD_CHUNK_SMALL = 8 * 1024 * 1024

VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".avi", ".mts", ".m2ts", ".lrf", ".insv"}
VIDEO_HEAVY_THRESHOLD_BYTES = 500 * 1024 * 1024
VIDEO_UPLOAD_CONCURRENCY = 8
LIGHT_UPLOAD_CONCURRENCY = 4
HEAVY_MAX_WORKERS = 16

OFFICE_EXTS = {
    ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".odt", ".ods", ".odp", ".rtf", ".pdf", ".txt",
    ".rar", ".zip", ".7z",
}
SKIP_EXTENSIONS = OFFICE_EXTS

EXT_PREFIX: Dict[str, str] = {
    ".dng": "DRN", ".cr3": "DRN", ".arw": "DRN",
    ".insv": "I360",
    ".mp4": "VID", ".mov": "VID", ".mkv": "VID",
    ".avi": "VID", ".mts": "VID", ".m2ts": "VID",
    ".srt": "VID", ".lrf": "VID",
    ".tiff": "FOT", ".tif": "FOT",
    ".png": "FOT", ".heic": "FOT", ".heif": "FOT",
}

JPEG_AS_FOT_WHEN_DRN = True

# ── Variables Graph desde entorno ────────────────────────────────────────────

def _clean_env(*keys: str) -> Optional[str]:
    for key in keys:
        value = os.getenv(key)
        if value is None:
            continue
        value = value.strip()
        if value and value.lower() not in {"none", "null"}:
            return value
    return None

GRAPH_TENANT_ID = _clean_env("AZURE_TENANT_ID", "TENANT_ID") or ""
GRAPH_CLIENT_ID = _clean_env("AZURE_CLIENT_ID", "CLIENT_ID") or ""
GRAPH_CLIENT_SECRET = _clean_env("AZURE_CLIENT_SECRET", "CLIENT_SECRET") or ""
CONTAINER_NAME = os.environ.get("BLOB_CONTAINER", "audiovisual")


# ════════════════════════════════════════════════════════════════════════════
# 1. TOKEN POOL — reutiliza token Graph, renueva solo cuando expira
# ════════════════════════════════════════════════════════════════════════════

class TokenPool:
    """Cache de token Graph thread-safe. Evita re-autenticar en cada worker."""

    def __init__(self) -> None:
        self._token: Optional[str] = None
        self._expira: float = 0.0
        self._lock = threading.Lock()
        self._app: Optional[msal.ConfidentialClientApplication] = None

    def _build_app(self) -> msal.ConfidentialClientApplication:
        if self._app is None:
            if not (GRAPH_TENANT_ID and GRAPH_CLIENT_ID and GRAPH_CLIENT_SECRET):
                raise ValueError(
                    "Faltan credenciales Graph: configura AZURE_TENANT_ID, "
                    "AZURE_CLIENT_ID y AZURE_CLIENT_SECRET en Application Settings."
                )
            self._app = msal.ConfidentialClientApplication(
                GRAPH_CLIENT_ID,
                authority=f"https://login.microsoftonline.com/{GRAPH_TENANT_ID}",
                client_credential=GRAPH_CLIENT_SECRET,
            )
        return self._app

    def get(self, force_refresh: bool = False) -> str:
        with self._lock:
            if (not force_refresh) and self._token and time.monotonic() < self._expira:
                return self._token
            app = self._build_app()
            result = app.acquire_token_for_client(scopes=GRAPH_SCOPE)
            if "access_token" not in result:
                raise RuntimeError(
                    f"Error autenticación Graph: {result.get('error_description')}"
                )
            self._token = result["access_token"]
            expires_in = int(result.get("expires_in", TOKEN_TTL_SECONDS))
            self._expira = time.monotonic() + max(60, min(TOKEN_TTL_SECONDS, expires_in - 120))
            log.info("Token Graph renovado.")
            return self._token


_token_pool = TokenPool()


def _get_graph_token(force_refresh: bool = False) -> str:
    return _token_pool.get(force_refresh=force_refresh)


# ════════════════════════════════════════════════════════════════════════════
# 2. HTTP helpers — reintentos exponenciales con Retry-After
# ════════════════════════════════════════════════════════════════════════════

_http_local = threading.local()


def _get_http_session() -> requests.Session:
    session = getattr(_http_local, "session", None)
    if session is None:
        session = requests.Session()
        adapter = HTTPAdapter(
            pool_connections=GRAPH_HTTP_POOL_SIZE,
            pool_maxsize=GRAPH_HTTP_POOL_SIZE,
        )
        session.mount("https://", adapter)
        session.mount("http://", adapter)
        _http_local.session = session
    return session

def _resolve_carpeta(project_code: str, project_name: str) -> str:
    code = (project_code or "").strip()
    slug = _slugify_name(project_name)

    if not code:
        return slug

    code_lower = code.lower()
    slug_lower = slug.lower()

    if code_lower == slug_lower:
        return code

    if code_lower.endswith(f"_{slug_lower}"):
        return code

    return f"{code}_{slug}"

def _with_retry(fn: Callable, max_retries: int = GRAPH_MAX_RETRIES, max_wait: Optional[int] = None):
    """`max_wait`: si Graph pide esperar más que esto (Retry-After grande por
    throttling), NO esperamos: lanzamos para que el llamador reintente más tarde
    y no quemar el timeout HTTP. Se usa en el listado reanudable."""
    last_error = None
    for attempt in range(1, max_retries + 1):
        try:
            resp = fn()
            if hasattr(resp, "status_code") and resp.status_code in {429, 500, 502, 503, 504}:
                if attempt == max_retries:
                    resp.raise_for_status()
                retry_after = resp.headers.get("Retry-After")
                wait = (
                    int(retry_after)
                    if retry_after and retry_after.isdigit()
                    else GRAPH_RETRY_BACKOFF ** attempt
                )
                if max_wait is not None and wait > max_wait:
                    raise RuntimeError(f"throttled: Graph pide esperar {wait}s")
                log.warning("HTTP %s. Reintento %s/%s en %ss", resp.status_code, attempt, max_retries, wait)
                time.sleep(wait)
                continue
            return resp
        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
            last_error = e
            if attempt == max_retries:
                break
            wait = GRAPH_RETRY_BACKOFF ** attempt
            log.warning("Timeout/conexión. Reintento %s/%s en %ss", attempt, max_retries, wait)
            time.sleep(wait)
    raise RuntimeError(f"Falló tras {max_retries} intentos: {last_error}")


def _graph_get(token: str, url: str, max_retries: int = GRAPH_MAX_RETRIES, max_wait: Optional[int] = None) -> dict:
    def _call():
        return _get_http_session().get(
            url,
            headers={"Authorization": f"Bearer {token}"},
            timeout=(GRAPH_CONNECT_TIMEOUT, GRAPH_READ_TIMEOUT),
        )
    resp = _with_retry(_call, max_retries=max_retries, max_wait=max_wait)
    resp.raise_for_status()
    return resp.json()


def _graph_list_all(token: str, url: str, max_retries: int = GRAPH_MAX_RETRIES, max_wait: Optional[int] = None) -> List[dict]:
    items: List[dict] = []
    next_url: Optional[str] = url
    while next_url:
        data = _graph_get(token, next_url, max_retries=max_retries, max_wait=max_wait)
        items.extend(data.get("value", []))
        next_url = data.get("@odata.nextLink")
    return items


def graph_item_download_url(token: str, drive_id: str, item_id: str) -> Optional[str]:
    """URL de descarga PRE-AUTENTICADA y fresca de un archivo (no necesita token).
    Es la que Azure Storage puede jalar directo con copy-from-url. Caduca ~1h,
    por eso se pide justo antes de copiar. La anotación @microsoft.graph.downloadUrl
    viene por defecto al pedir el item (no se obtiene con $select)."""
    data = _graph_get(token, f"{GRAPH_BASE}/drives/{drive_id}/items/{item_id}")
    return data.get("@microsoft.graph.downloadUrl")


def _graph_download_to_path(
    token: str,
    download_url: str,
    dest_path: str,
    chunk_size: int = CHUNK_SIZE,
) -> str:
    def _call():
        return _get_http_session().get(
            download_url,
            headers={"Authorization": f"Bearer {token}"},
            timeout=(GRAPH_CONNECT_TIMEOUT, GRAPH_DOWNLOAD_READ_TIMEOUT),
            stream=True,
        )

    for attempt in range(1, GRAPH_DOWNLOAD_RETRIES + 1):
        try:
            resp = _with_retry(_call)
            resp.raise_for_status()
            with open(dest_path, "wb") as fh:
                for chunk in resp.iter_content(chunk_size=chunk_size):
                    if chunk:
                        fh.write(chunk)
            return dest_path
        except (
            requests.exceptions.ReadTimeout,
            requests.exceptions.Timeout,
            requests.exceptions.ConnectionError,
            requests.exceptions.ChunkedEncodingError,
        ) as e:
            if attempt == GRAPH_DOWNLOAD_RETRIES:
                raise
            wait = GRAPH_RETRY_BACKOFF ** attempt
            log.warning("Timeout descarga. Reintento %s/%s en %ss", attempt, GRAPH_DOWNLOAD_RETRIES, wait)
            time.sleep(wait)

    raise RuntimeError(f"Falló descarga tras {GRAPH_DOWNLOAD_RETRIES} intentos: {download_url}")


def _download_request_headers(url: str) -> Dict[str, str]:
    """Agrega token Bearer solo para URLs de Graph API."""
    if url.startswith(GRAPH_BASE):
        return {"Authorization": f"Bearer {_get_graph_token()}"}
    return {}


# ════════════════════════════════════════════════════════════════════════════
# 3. LISTAR ARCHIVOS — SharePoint y OneDrive
# ════════════════════════════════════════════════════════════════════════════

def _url_children(base_drive_url: str, folder_path: str) -> str:
    normalized = requests.utils.unquote(folder_path or "/")
    if normalized == "/":
        return f"{base_drive_url}/root/children"
    encoded = requests.utils.quote(normalized, safe="/")
    return f"{base_drive_url}/root:{encoded}:/children"


def _listar_archivos_drive(
    token: str,
    base_drive_url: str,
    folder_path: str = "/",
    recursive: bool = True,
) -> Tuple[List[dict], int]:
    pendientes = [_url_children(base_drive_url, folder_path)]
    files: List[dict] = []
    folders = 0

    while pendientes:
        items = _graph_list_all(token, pendientes.pop(0))
        for item in items:
            if "file" in item:
                files.append(item)
            elif recursive and "folder" in item:
                drive_id = item.get("parentReference", {}).get("driveId")
                item_id = item.get("id")
                if drive_id and item_id:
                    pendientes.append(f"{GRAPH_BASE}/drives/{drive_id}/items/{item_id}/children")
                    folders += 1

    return files, folders


def list_sharepoint_files(
    token: str,
    site_id: str,
    folder_path: str = "/",
    recursive: bool = True,
) -> List[dict]:
    base = f"{GRAPH_BASE}/sites/{site_id}/drive"
    files, folders = _listar_archivos_drive(token, base, folder_path, recursive)
    log.info("SharePoint: %s archivos | %s subcarpetas en %s", len(files), folders, folder_path)
    return files


def list_onedrive_files(
    token: str,
    user_email: str,
    folder_path: str = "/",
    recursive: bool = True,
) -> List[dict]:
    base = f"{GRAPH_BASE}/users/{user_email}/drive"
    files, folders = _listar_archivos_drive(token, base, folder_path, recursive)
    log.info("OneDrive (%s): %s archivos | %s subcarpetas en %s", user_email, len(files), folders, folder_path)
    return files


def list_drive_tree(
    token: str,
    base_drive_url: str,
    folder_path: str = "/",
    recursive: bool = True,
) -> List[Tuple[str, dict]]:
    """Como _listar_archivos_drive pero conservando la RUTA RELATIVA de cada
    archivo respecto a la carpeta pedida. Devuelve [(relDir, item), ...] con
    relDir = "" para la raíz, "sub", "sub/sub2", etc. Para biblioteca (media),
    donde se preserva la estructura de subcarpetas."""
    pend: List[Tuple[str, str]] = [(_url_children(base_drive_url, folder_path), "")]
    out: List[Tuple[str, dict]] = []
    while pend:
        url, rel = pend.pop(0)
        for item in _graph_list_all(token, url):
            if "file" in item:
                out.append((rel, item))
            elif recursive and "folder" in item:
                drive_id = item.get("parentReference", {}).get("driveId")
                item_id = item.get("id")
                if drive_id and item_id:
                    child_rel = f"{rel}/{item.get('name', '')}" if rel else item.get("name", "")
                    pend.append((f"{GRAPH_BASE}/drives/{drive_id}/items/{item_id}/children", child_rel))
    return out


def graph_drive_base(source: str, site_id: str = "", user_email: str = "") -> str:
    """URL base del drive según el origen (SharePoint por site, OneDrive por usuario)."""
    if source == "onedrive":
        return f"{GRAPH_BASE}/users/{user_email}/drive"
    return f"{GRAPH_BASE}/sites/{site_id}/drive"


def children_url(base_drive_url: str, folder_path: str = "/") -> str:
    """URL pública para listar los hijos de una carpeta (para sembrar el cursor)."""
    return _url_children(base_drive_url, folder_path)


def list_drive_tree_budgeted(
    token: str,
    pending: List[list],
    budget_s: float = 120.0,
) -> Tuple[List[dict], List[list]]:
    """Recorre el árbol de carpetas por LOTES acotados en tiempo, para que el
    'Analizar' de la web no choque con el timeout HTTP aunque Graph throttlee.

    `pending`: cola BFS [[folder_children_url, rel], ...]. Devuelve
    (files, remaining): los archivos hallados en esta tanda y la cola que falta.
    El cliente vuelve a llamar con `remaining` hasta que quede vacía."""
    files: List[dict] = []
    pend: List[list] = [list(x) for x in pending]
    started = time.monotonic()
    while pend and (time.monotonic() - started) < budget_s:
        url, rel = pend.pop(0)
        try:
            # Reintentos cortos y sin esperas largas: si Graph throttlea fuerte,
            # devolvemos la carpeta a la cola y cortamos la tanda (el cliente
            # reintenta luego), en vez de quemar el timeout del request.
            children = _graph_list_all(token, url, max_retries=3, max_wait=15)
        except Exception:
            pend.insert(0, [url, rel])
            break
        for item in children:
            if "file" in item:
                pr = item.get("parentReference", {})
                files.append({
                    "driveId": pr.get("driveId"),
                    "itemId": item.get("id"),
                    "name": item.get("name", ""),
                    "size": int(item.get("size") or 0),
                    "relDir": rel,
                    "lastModified": item.get("lastModifiedDateTime"),
                })
            elif "folder" in item:
                did = item.get("parentReference", {}).get("driveId")
                iid = item.get("id")
                if did and iid:
                    child_rel = f"{rel}/{item.get('name', '')}" if rel else item.get("name", "")
                    pend.append([f"{GRAPH_BASE}/drives/{did}/items/{iid}/children", child_rel])
    return files, pend


# ════════════════════════════════════════════════════════════════════════════
# 4. BLOB INDEX — 1 operación de lista en lugar de N blob.exists()
# ════════════════════════════════════════════════════════════════════════════

def construir_blob_index(blob_svc: BlobServiceClient, prefix: str = "") -> set:
    """
    Lista todos los blobs del container con el prefijo dado y retorna un set de rutas.

    Costo: 1 op de lista vs N ops de lectura individual.
    Para 2000 archivos:
      - blob.exists() x2000  → 2000 ops  → ~$0.002
      - list_blobs x1        →    1 op   → ~$0.000001
    """
    container = blob_svc.get_container_client(CONTAINER_NAME)
    index = {blob.name for blob in container.list_blobs(name_starts_with=prefix)}
    log.info("Blob index: %s blobs existentes (prefijo: '%s')", len(index), prefix or "/")
    return index


# ════════════════════════════════════════════════════════════════════════════
# 5. RENOMBRADO — prefijo + fecha inferida + secuencia
# ════════════════════════════════════════════════════════════════════════════

def detectar_prefijo(nombre_original: str, prefijo_jpg: str = "FOT") -> str:
    ext = Path(nombre_original).suffix.lower()
    pref = (prefijo_jpg or "FOT").strip().upper()

    if ext == ".jpg":
        return pref
    if ext == ".jpeg":
        # Si el prefijo_jpg es DRN, los .jpeg se tratan como FOT (foto normal)
        if JPEG_AS_FOT_WHEN_DRN and pref == "DRN":
            return "FOT"
        return pref
    if ext in {".heic", ".heif"}:
        return pref
    if ext in OFFICE_EXTS:
        return "SKIP"
    return EXT_PREFIX.get(ext, "FOT")


def _numero_semana_iso(fecha: datetime) -> str:
    year, week, _ = fecha.isocalendar()
    return f"{year}_S{week:02d}"


def _semana_iso_segura(year: int, week: int) -> Optional[datetime]:
    if not (1 <= week <= 53):
        return None
    max_week = datetime(year, 12, 28).isocalendar().week
    week_ajustada = min(week, max_week)
    return datetime.fromisocalendar(year, week_ajustada, 1).replace(tzinfo=timezone.utc)


def extraer_fecha_desde_texto(texto: str) -> Optional[datetime]:
    if not texto:
        return None
    m_ts = re.search(r"(?<!\d)(20\d{2})(0[1-9]|1[0-2])([0-2]\d|3[0-1])\d{6}(?!\d)", texto)
    if m_ts:
        try:
            return datetime(int(m_ts.group(1)), int(m_ts.group(2)), int(m_ts.group(3)), tzinfo=timezone.utc)
        except ValueError:
            pass

    patrones = [
        ("ymd4", r"(?<!\d)(20\d{2})[-_./]?(0[1-9]|1[0-2])[-_./]?([0-2]\d|3[0-1])(?!\d)"),
        ("dmy4", r"(?<!\d)([0-2]\d|3[0-1])[-_./](0[1-9]|1[0-2])[-_./](20\d{2})(?!\d)"),
        ("ymd2", r"(?<!\d)(\d{2})(0[1-9]|1[0-2])([0-2]\d|3[0-1])(?!\d)"),
    ]
    for tipo, patron in patrones:
        for m in re.finditer(patron, texto):
            try:
                if tipo == "ymd4":
                    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
                elif tipo == "dmy4":
                    d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
                else:
                    y, mo, d = 2000 + int(m.group(1)), int(m.group(2)), int(m.group(3))
                return datetime(y, mo, d, tzinfo=timezone.utc)
            except ValueError:
                continue
    return None


def extraer_semana_desde_texto(texto: str) -> Optional[datetime]:
    if not texto:
        return None
    m = re.search(r"(20\d{2})\s*[_-]?\s*[sS](\d{1,2})", texto)
    if m:
        fecha = _semana_iso_segura(int(m.group(1)), int(m.group(2)))
        if fecha:
            return fecha

    m2 = re.search(r"semana\s*[_-]?(\d{1,2})", texto, flags=re.IGNORECASE)
    m_year = re.search(r"(20\d{2})", texto)
    if m2 and m_year:
        return _semana_iso_segura(int(m_year.group(1)), int(m2.group(1)))
    return None


def _ruta_humana_item(item: dict) -> str:
    raw_path = item.get("parentReference", {}).get("path", "")
    if "root:" in raw_path:
        return raw_path.split("root:", 1)[1]
    return raw_path


def inferir_fecha(item: dict) -> datetime:
    nombre = item.get("name", "")
    ruta = _ruta_humana_item(item)

    fecha = extraer_fecha_desde_texto(nombre) or extraer_semana_desde_texto(nombre)
    if not fecha:
        texto = " | ".join(filter(None, [nombre, ruta]))
        fecha = extraer_fecha_desde_texto(texto) or extraer_semana_desde_texto(texto)
    if fecha:
        return fecha

    file_info = item.get("fileSystemInfo", {})
    created = file_info.get("createdDateTime") or item.get("lastModifiedDateTime")
    if created:
        return datetime.fromisoformat(created.replace("Z", "+00:00"))
    return datetime.now(timezone.utc)


def renombrar_archivo(
    nombre_original: str,
    fecha_captura: datetime,
    secuencia: int,
    prefijo_jpg: str = "FOT",
) -> str:
    prefijo = detectar_prefijo(nombre_original, prefijo_jpg)
    fecha_str = fecha_captura.strftime("%Y%m%d")
    ext = Path(nombre_original).suffix.lower()
    return f"{prefijo}_{fecha_str}_{secuencia:03d}{ext}"


# ════════════════════════════════════════════════════════════════════════════
# 6. HELPERS GENERALES
# ════════════════════════════════════════════════════════════════════════════

def _slugify_name(name: str) -> str:
    s = (name or "").strip().lower()
    s = re.sub(r"[^a-z0-9-]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s or "project"


def _week_iso_for_date(dt: Optional[datetime] = None) -> str:
    d = dt or datetime.now(timezone.utc)
    year, week, _ = d.isocalendar()
    return f"{year}_S{week:02d}"


def _guess_filename_from_url(url: str) -> str:
    p = Path(requests.utils.urlparse(url).path)
    name = p.name
    if not name:
        return f"file_{int(datetime.now().timestamp())}.bin"
    return name


def content_type_para(nombre: str) -> str:
    ext = Path(nombre).suffix.lower()
    tipos = {
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".tiff": "image/tiff", ".tif": "image/tiff",
        ".heic": "image/heic", ".heif": "image/heif",
        ".dng": "image/x-adobe-dng",
        ".cr3": "image/x-canon-cr3",
        ".arw": "image/x-sony-arw",
        ".mp4": "video/mp4",
        ".mov": "video/quicktime",
        ".mkv": "video/x-matroska",
        ".avi": "video/x-msvideo",
        ".mts": "video/mp2t", ".m2ts": "video/mp2t",
        ".srt": "text/plain; charset=utf-8",
        ".insv": "application/octet-stream",
        ".lrf": "application/octet-stream",
    }
    tipo = tipos.get(ext)
    if tipo:
        return tipo
    guess, _ = mimetypes.guess_type(nombre)
    return guess or "application/octet-stream"


def es_video_archivo(nombre: str) -> bool:
    return Path(nombre).suffix.lower() in VIDEO_EXTS


def es_trabajo_pesado(trabajo: dict) -> bool:
    size_bytes = int(trabajo.get("size_bytes", 0) or 0)
    nombre = trabajo.get("nombre_nuevo") or trabajo.get("nombre_orig") or ""
    return es_video_archivo(nombre) or size_bytes >= VIDEO_HEAVY_THRESHOLD_BYTES


# ════════════════════════════════════════════════════════════════════════════
# 7. SUBIDA A BLOB
# ════════════════════════════════════════════════════════════════════════════

def _subir_a_blob_desde_path(
    blob_svc: BlobServiceClient,
    local_path: str,
    blob_path: str,
    content_type: str = "application/octet-stream",
    tier: StandardBlobTier = StandardBlobTier.COOL,
    max_concurrency: int = 8,
) -> None:
    container = blob_svc.get_container_client(CONTAINER_NAME)
    with open(local_path, "rb") as contenido:
        container.upload_blob(
            name=blob_path,
            data=contenido,
            overwrite=False,
            standard_blob_tier=tier,
            max_concurrency=max_concurrency,
            content_settings=ContentSettings(content_type=content_type),
        )


# ════════════════════════════════════════════════════════════════════════════
# 8. PREPARAR TRABAJOS — calcula rutas destino para Graph items
# ════════════════════════════════════════════════════════════════════════════

def _preparar_trabajos(
    archivos: List[dict],
    carpeta_proyecto: str,
    prefijo_jpg: str,
) -> List[dict]:
    contadores: Dict[str, int] = {}
    trabajos: List[dict] = []

    archivos_ordenados = sorted(archivos, key=inferir_fecha)
    for item in archivos_ordenados:
        nombre_orig = item.get("name", "")
        ext = Path(nombre_orig).suffix.lower()

        if ext in SKIP_EXTENSIONS:
            continue

        fecha = inferir_fecha(item)
        semana = _numero_semana_iso(fecha)
        prefijo = detectar_prefijo(nombre_orig, prefijo_jpg)

        if prefijo == "SKIP":
            continue

        clave = f"{prefijo}_{fecha.strftime('%Y%m%d')}"
        contadores[clave] = contadores.get(clave, 0) + 1
        seq = contadores[clave]

        nombre_nuevo = renombrar_archivo(nombre_orig, fecha, seq, prefijo_jpg)
        blob_path = f"{carpeta_proyecto}/{semana}/{nombre_nuevo}"

        drive_id = item.get("parentReference", {}).get("driveId")
        item_id = item.get("id")
        dl_url = (
            f"{GRAPH_BASE}/drives/{drive_id}/items/{item_id}/content"
            if drive_id and item_id
            else item.get("@microsoft.graph.downloadUrl")
        )

        if not dl_url:
            log.warning("No se pudo determinar URL de descarga para %s", nombre_orig)
            continue

        trabajos.append({
            "nombre_orig": nombre_orig,
            "nombre_nuevo": nombre_nuevo,
            "blob_path": blob_path,
            "dl_url": dl_url,
            "drive_id": drive_id,
            "item_id": item_id,
            "size_bytes": item.get("size", 0),
        })

    return trabajos


# ════════════════════════════════════════════════════════════════════════════
# 9. PROCESAR UN TRABAJO — descarga + subida con métricas
# ════════════════════════════════════════════════════════════════════════════

def _procesar_un_trabajo(
    trabajo: dict,
    blob_svc: BlobServiceClient,
    semaforo: threading.Semaphore,
    token_base: str,
    chunk_size: int,
    upload_concurrency: int,
    progress_cb: Optional[Callable] = None,
    idx: int = -1,
) -> Tuple[str, Any]:
    with semaforo:
        tmp_path = None
        try:
            log.info(
                "  📄  %s  →  %s  (%.1f MB)",
                trabajo["nombre_orig"],
                trabajo["nombre_nuevo"],
                (trabajo.get("size_bytes", 0) or 0) / 1024 / 1024,
            )
            t0 = time.perf_counter()
            suffix = Path(trabajo["nombre_nuevo"]).suffix or ".bin"

            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp_file:
                tmp_path = tmp_file.name

            token_actual = token_base
            if progress_cb:
                progress_cb(idx, "downloading", {"name": trabajo["nombre_orig"], "total": trabajo.get("size_bytes", 0), "downloaded": 0})

            t_dl_ini = time.perf_counter()
            try:
                _graph_download_to_path(token_actual, trabajo["dl_url"], tmp_path, chunk_size=chunk_size)
            except requests.exceptions.HTTPError as e:
                if "401" in str(e) and "graph.microsoft.com" in trabajo.get("dl_url", ""):
                    log.warning("401 Graph. Renovando token para %s", trabajo["nombre_orig"])
                    token_actual = _get_graph_token(force_refresh=True)
                    _graph_download_to_path(token_actual, trabajo["dl_url"], tmp_path, chunk_size=chunk_size)
                else:
                    raise
            t_dl = time.perf_counter() - t_dl_ini

            actual_size = os.path.getsize(tmp_path)
            if progress_cb:
                progress_cb(idx, "downloaded", {"name": trabajo["nombre_orig"], "size": actual_size})

            if progress_cb:
                progress_cb(idx, "uploading", {"name": trabajo["nombre_nuevo"], "size": actual_size})

            t_ul_ini = time.perf_counter()
            try:
                _subir_a_blob_desde_path(
                    blob_svc,
                    tmp_path,
                    trabajo["blob_path"],
                    content_type=content_type_para(trabajo["nombre_nuevo"]),
                    max_concurrency=upload_concurrency,
                )
            except ResourceExistsError:
                # Carrera con otra subida simultánea: ya existe, es un skip, no un error
                log.info("  ⏭️  Ya existía (carrera): %s", trabajo["blob_path"])
                if progress_cb:
                    progress_cb(idx, "skipped", {"name": trabajo["nombre_nuevo"], "blob": trabajo["blob_path"]})
                return "skipped", trabajo["blob_path"]
            t_ul = time.perf_counter() - t_ul_ini
            t_total = time.perf_counter() - t0

            if progress_cb:
                progress_cb(idx, "uploaded", {
                    "name": trabajo["nombre_nuevo"],
                    "blob": trabajo["blob_path"],
                    "size": actual_size,
                })

            size_mb = (trabajo.get("size_bytes", 0) or 0) / (1024 * 1024)
            return "ok", {
                "size_bytes": trabajo.get("size_bytes", 0),
                "actual_size": actual_size,
                "dl_s": t_dl,
                "ul_s": t_ul,
                "total_s": t_total,
                "dl_mbps": size_mb / t_dl if t_dl > 0 else 0.0,
                "ul_mbps": size_mb / t_ul if t_ul > 0 else 0.0,
                "eff_mbps": size_mb / t_total if t_total > 0 else 0.0,
            }
        except Exception as e:
            log.exception("Error procesando %s: %s", trabajo.get("nombre_orig"), e)
            if progress_cb:
                progress_cb(idx, "error", {"name": trabajo.get("nombre_orig", ""), "error": str(e)})
            return "error", str(e)
        finally:
            if tmp_path and os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass


# ════════════════════════════════════════════════════════════════════════════
# 10. PROCESAR ARCHIVOS — motor principal
# ════════════════════════════════════════════════════════════════════════════

def procesar_archivos(
    archivos: List[dict],
    blob_svc: BlobServiceClient,
    codigo_proyecto: str,
    nombre_corto: str,
    prefijo_jpg: str = "FOT",
    max_workers: int = 12,
    progress_cb: Optional[Callable] = None,
) -> dict:
    """
    Motor principal. Construye blob index una vez, separa livianos vs pesados,
    procesa en paralelo con semáforo para no saturar Graph API.
    """
    carpeta_proyecto = _resolve_carpeta(
        codigo_proyecto,
        nombre_corto
    )
    resumen = {
        "subidos": 0, "omitidos": 0, "errores": 0,
        "bytes_subidos": 0, "archivos_medidos": 0,
        "dl_mbps_prom": 0.0, "ul_mbps_prom": 0.0, "eff_mbps_prom": 0.0,
    }

    blob_index = construir_blob_index(blob_svc, prefix=carpeta_proyecto)
    trabajos = _preparar_trabajos(archivos, carpeta_proyecto, prefijo_jpg)

    if not trabajos:
        log.info("Sin archivos para procesar en %s", carpeta_proyecto)
        return resumen

    nuevos = [t for t in trabajos if t["blob_path"] not in blob_index]
    ya_existentes = [t for t in trabajos if t["blob_path"] in blob_index]

    resumen["omitidos"] = len(ya_existentes)
    if ya_existentes:
        log.info("  ⏭️  %s archivos ya existen, omitidos.", len(ya_existentes))

    if not nuevos:
        log.info("  ✅  Nada nuevo en %s", carpeta_proyecto)
        return resumen

    pesados = [t for t in nuevos if es_trabajo_pesado(t)]
    livianos = [t for t in nuevos if t not in pesados]

    log.info("📁  %s: %s archivos nuevos (%s livianos, %s pesados)",
             carpeta_proyecto, len(nuevos), len(livianos), len(pesados))

    semaforo = threading.Semaphore(GRAPH_MAX_CONCURRENT)
    token = _get_graph_token()

    dl_mbps_sum = ul_mbps_sum = eff_mbps_sum = 0.0

    grupos = [
        ("livianos", livianos, max(1, min(max_workers, len(livianos))),   DOWNLOAD_CHUNK_SMALL,  LIGHT_UPLOAD_CONCURRENCY),
        ("pesados",  pesados,  max(1, min(HEAVY_MAX_WORKERS, max_workers, len(pesados))), GRAPH_DOWNLOAD_CHUNK, VIDEO_UPLOAD_CONCURRENCY),
    ]

    for etiqueta, grupo, workers, chunk_size, upload_conc in grupos:
        if not grupo:
            continue
        log.info("  ▶ Procesando %s con %s hilos", etiqueta, workers)
        with ThreadPoolExecutor(max_workers=workers, thread_name_prefix=f"ripcon-{etiqueta}") as executor:
            futures = {
                executor.submit(
                    _procesar_un_trabajo,
                    t, blob_svc, semaforo, token, chunk_size, upload_conc,
                    progress_cb, i,
                ): t
                for i, t in enumerate(grupo)
            }
            for future in as_completed(futures):
                estado, payload = future.result()
                if estado == "ok":
                    resumen["subidos"] += 1
                    pl = payload if isinstance(payload, dict) else {}
                    resumen["bytes_subidos"] += pl.get("size_bytes", 0) or 0
                    dl_mbps_sum += pl.get("dl_mbps", 0.0)
                    ul_mbps_sum += pl.get("ul_mbps", 0.0)
                    eff_mbps_sum += pl.get("eff_mbps", 0.0)
                    resumen["archivos_medidos"] += 1
                    log.info("  ✅  Subido: %s", futures[future]["blob_path"])
                elif estado == "skipped":
                    resumen["omitidos"] += 1
                else:
                    resumen["errores"] += 1
                    log.error("  ❌  Error con %s: %s", futures[future]["nombre_orig"], payload)

    if resumen["archivos_medidos"] > 0:
        n = resumen["archivos_medidos"]
        resumen["dl_mbps_prom"] = dl_mbps_sum / n
        resumen["ul_mbps_prom"] = ul_mbps_sum / n
        resumen["eff_mbps_prom"] = eff_mbps_sum / n

    return resumen


# ════════════════════════════════════════════════════════════════════════════
# 11. RESOLVER URL SHAREPOINT
# ════════════════════════════════════════════════════════════════════════════

def resolver_sharepoint_desde_url(url: str) -> dict:
    """
    Parsea una URL de SharePoint y retorna site_id, folder_path, etc.

    Ejemplo:
        https://ripconcivcialtda.sharepoint.com/sites/GestindeProyectos/
        Documentos%20compartidos/33007.../03.10%20FOTOS%20Y%20VIDEOS
    """
    from urllib.parse import urlparse, unquote
    parsed = urlparse(url)
    host = parsed.netloc
    path_parts = [p for p in parsed.path.split("/") if p]

    if len(path_parts) < 3 or path_parts[0] != "sites":
        raise ValueError(f"URL no tiene estructura /sites/SITIO: {url}")

    site_name = path_parts[1]
    site_rel_path = f"sites/{site_name}"
    library_name = unquote(path_parts[2]) if len(path_parts) > 2 else "Documentos compartidos"
    folder_path_raw = path_parts[3:] if len(path_parts) > 3 else []
    folder_path = "/" + "/".join(unquote(p) for p in folder_path_raw)

    log.info("SharePoint URL Parser: %s | %s | %s", host, site_rel_path, library_name)
    token = _get_graph_token()

    try:
        site_data = _graph_get(token, f"{GRAPH_BASE}/sites/{host}:/{site_rel_path}")
        site_id = site_data.get("id")
    except Exception as e:
        log.error("Error obteniendo site_id: %s", e)
        site_id = None

    return {
        "host": host,
        "site_rel_path": site_rel_path,
        "site_name": site_name,
        "site_id": site_id,
        "folder_path": folder_path,
    }


# ════════════════════════════════════════════════════════════════════════════
# 12. FUNCIONES DE ALTO NIVEL — SharePoint / OneDrive
# ════════════════════════════════════════════════════════════════════════════

def upload_from_sharepoint(
    site_id: str,
    folder_path: str,
    codigo_proyecto: str,
    nombre_corto: str,
    prefijo_jpg: str = "FOT",
    recursive: bool = True,
    max_workers: int = 4,
) -> dict:
    """
    Lista archivos en SharePoint y los sube a Blob con renombrado inteligente.

    Ejemplo:
        config = resolver_sharepoint_desde_url(url)
        upload_from_sharepoint(
            site_id=config["site_id"],
            folder_path=config["folder_path"],
            codigo_proyecto="28002",
            nombre_corto="confluencia-puembo",
            prefijo_jpg="FOT",
        )
    """
    log.info("\n🚀  SharePoint → %s_%s", codigo_proyecto, nombre_corto)
    token = _get_graph_token()
    archivos = list_sharepoint_files(token, site_id, folder_path, recursive)
    blob_svc = BlobServiceClient.from_connection_string(
        os.environ.get("AZURE_STORAGE_CONNECTION_STRING", "")
    )
    resumen = procesar_archivos(archivos, blob_svc, codigo_proyecto, nombre_corto, prefijo_jpg, max_workers)
    log.info("\n📊  %s: %s subidos | %s omitidos | %s errores",
             codigo_proyecto, resumen["subidos"], resumen["omitidos"], resumen["errores"])
    return resumen


def upload_from_onedrive(
    user_email: str,
    folder_path: str,
    codigo_proyecto: str,
    nombre_corto: str,
    prefijo_jpg: str = "FOT",
    recursive: bool = True,
    max_workers: int = 4,
) -> dict:
    """
    Lista archivos en OneDrive de un usuario y los sube a Blob.

    Ejemplo:
        upload_from_onedrive(
            user_email="juan@ripcon.com",
            folder_path="/Fotos Obra/Semana 15",
            codigo_proyecto="33014",
            nombre_corto="promart-quitumbe",
            prefijo_jpg="DRN",
        )
    """
    log.info("\n🚀  OneDrive (%s) → %s_%s", user_email, codigo_proyecto, nombre_corto)
    token = _get_graph_token()
    archivos = list_onedrive_files(token, user_email, folder_path, recursive)
    blob_svc = BlobServiceClient.from_connection_string(
        os.environ.get("AZURE_STORAGE_CONNECTION_STRING", "")
    )
    resumen = procesar_archivos(archivos, blob_svc, codigo_proyecto, nombre_corto, prefijo_jpg, max_workers)
    log.info("\n📊  %s: %s subidos | %s omitidos | %s errores",
             codigo_proyecto, resumen["subidos"], resumen["omitidos"], resumen["errores"])
    return resumen


# ════════════════════════════════════════════════════════════════════════════
# 13. UPLOAD DESDE URLS DIRECTAS — interfaz compatible con function_app.py
# ════════════════════════════════════════════════════════════════════════════
#
# Esta sección mantiene la interfaz que function_app.py ya usa:
#   - upload_urls(...)
#   - upload_urls_with_progress(...)
#   - _guess_filename_from_url(...)
#   - _slugify_name(...)
#   - _week_iso_for_date(...)
#
# Internamente usan blob index único y descarga con chunks.
# ════════════════════════════════════════════════════════════════════════════

def _is_sharepoint_or_onedrive_url(url: str) -> bool:
    parsed = requests.utils.urlparse(url)
    if not parsed.scheme or not parsed.netloc:
        return False
    host = parsed.netloc.lower()
    return "sharepoint.com" in host or "onedrive.live.com" in host or "1drv.ms" in host


def _encode_graph_share_id(url: str) -> str:
    raw = f"u!{url}".encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")


def _resolve_graph_share_url(url: str) -> dict:
    from urllib.parse import unquote as _unquote
    candidates = [url]
    try:
        candidates.append(requests.utils.requote_uri(url))
    except Exception:
        pass
    try:
        u = _unquote(url)
        candidates.append(u)
        candidates.append(requests.utils.requote_uri(u))
    except Exception:
        pass

    last_exc = None
    token = _get_graph_token()
    for cand in candidates:
        try:
            share_id = _encode_graph_share_id(cand)
            item = _graph_get(token, f"{GRAPH_BASE}/shares/{share_id}/driveItem")
            if "file" in item:
                dl = item.get("@microsoft.graph.downloadUrl")
                if not dl:
                    drive_id = item.get("parentReference", {}).get("driveId")
                    item_id = item.get("id")
                    if drive_id and item_id:
                        dl = f"{GRAPH_BASE}/drives/{drive_id}/items/{item_id}/content"
                if not dl:
                    raise ValueError("No se pudo obtener la URL de descarga.")
                return {"downloadUrl": dl, "name": item.get("name") or _guess_filename_from_url(cand)}
            if "folder" in item:
                return {"folder": True, "item": item, "shareId": share_id, "name": item.get("name")}
        except requests.exceptions.HTTPError as e:
            last_exc = e
            continue
        except Exception as e:
            last_exc = e
            continue

    raise ValueError(f"No se pudo resolver el enlace: {last_exc}")


def _resolve_download_url(url: str) -> Tuple[str, str]:
    if _is_sharepoint_or_onedrive_url(url):
        try:
            resolved = _resolve_graph_share_url(url)
            if isinstance(resolved, dict) and resolved.get("downloadUrl"):
                return resolved["downloadUrl"], resolved["name"]
        except Exception as e:
            log.warning("_resolve_download_url: no pudo resolver %s: %s", url, e)
    return url, _guess_filename_from_url(url)


def _download_stream_to_tempfile(
    download_url: str,
    name: str,
    tmp_path: str,
    progress_cb: Optional[Callable] = None,
    idx: int = -1,
) -> Tuple[str, str, int]:
    """Descarga con streaming a tempfile, con reintentos completos ante cortes
    de red (crítico en archivos de varias GB)."""
    headers = _download_request_headers(download_url)
    last_exc: Optional[Exception] = None

    for attempt in range(1, GRAPH_DOWNLOAD_RETRIES + 1):
        downloaded = 0
        try:
            with _get_http_session().get(
                download_url, stream=True, headers=headers,
                timeout=(GRAPH_CONNECT_TIMEOUT, GRAPH_DOWNLOAD_READ_TIMEOUT),
            ) as resp:
                resp.raise_for_status()
                total = int(resp.headers.get("Content-Length") or 0)
                if progress_cb:
                    progress_cb(idx, "downloading", {"name": name, "total": total, "downloaded": 0})
                with open(tmp_path, "wb") as fh:
                    for chunk in resp.iter_content(chunk_size=CHUNK_SIZE):
                        if chunk:
                            fh.write(chunk)
                            downloaded += len(chunk)
                            if progress_cb:
                                progress_cb(idx, "downloading", {"name": name, "total": total, "downloaded": downloaded})
            return name, content_type_para(name), downloaded
        except (
            requests.exceptions.Timeout,
            requests.exceptions.ConnectionError,
            requests.exceptions.ChunkedEncodingError,
        ) as e:
            last_exc = e
            if attempt == GRAPH_DOWNLOAD_RETRIES:
                break
            wait = GRAPH_RETRY_BACKOFF ** attempt
            log.warning("Descarga interrumpida (%s). Reintento %s/%s en %ss",
                        name, attempt, GRAPH_DOWNLOAD_RETRIES, wait)
            time.sleep(wait)

    raise RuntimeError(f"Descarga falló tras {GRAPH_DOWNLOAD_RETRIES} intentos: {last_exc}")


def _download_url_to_tempfile(
    url: str,
    tmp_path: str,
    progress_cb: Optional[Callable] = None,
    idx: int = -1,
) -> Tuple[str, str, int]:
    download_url, name = _resolve_download_url(url)
    return _download_stream_to_tempfile(download_url, name, tmp_path, progress_cb, idx)


def _upload_file_in_blocks(
    container,
    blob_path: str,
    tmp_path: str,
    content_type: str,
    progress_cb: Optional[Callable] = None,
    idx: int = -1,
) -> None:
    from azure.storage.blob import BlobBlock
    blob_client = container.get_blob_client(blob_path)
    block_ids: List[str] = []
    uploaded = 0
    block_index = 0

    with open(tmp_path, "rb") as fh:
        while True:
            chunk = fh.read(CHUNK_SIZE)
            if not chunk:
                break
            block_id = base64.b64encode(f"{block_index:08d}".encode()).decode()
            # Reintento por bloque: un corte de red no tira la subida completa
            for attempt in range(1, 4):
                try:
                    blob_client.stage_block(block_id=block_id, data=chunk)
                    break
                except Exception as e:
                    if attempt == 3:
                        raise
                    wait = GRAPH_RETRY_BACKOFF ** attempt
                    log.warning("stage_block falló (bloque %s). Reintento %s/3 en %ss: %s",
                                block_index, attempt, wait, e)
                    time.sleep(wait)
            block_ids.append(block_id)
            uploaded += len(chunk)
            block_index += 1
            if progress_cb:
                progress_cb(idx, "uploading", {"uploaded": uploaded})

    blob_client.commit_block_list(
        [BlobBlock(id=b) for b in block_ids],
        content_settings=ContentSettings(content_type=content_type),
    )


def upload_urls(
    blob_svc: BlobServiceClient,
    project_code: str,
    project_name: str,
    urls: List[str],
    prefijo: Optional[str] = None,
    max_workers: int = 4,
) -> Dict[str, Any]:
    """Descarga cada URL y la sube al container. Retorna resumen."""
    week = _week_iso_for_date()
    carpeta = _resolve_carpeta(project_code, project_name)

    results: Dict[str, Any] = {"uploaded": 0, "skipped": 0, "errors": [], "details": []}

    container = blob_svc.get_container_client(CONTAINER_NAME)
    blob_index = construir_blob_index(blob_svc, prefix=carpeta)

    def _worker(url: str) -> Dict[str, Any]:
        tmp_path = None
        try:
            download_url, name = _resolve_download_url(url)
            blob_path = f"{carpeta}/{week}/{name}"
            if blob_path in blob_index:
                return {"url": url, "ok": False, "skipped": True, "blob": blob_path}

            with tempfile.NamedTemporaryFile(delete=False) as tmpf:
                tmp_path = tmpf.name
            name, ct, downloaded = _download_stream_to_tempfile(download_url, name, tmp_path)
            _upload_file_in_blocks(container, blob_path, tmp_path, ct)
            return {"url": url, "ok": True, "blob": blob_path, "size": downloaded}
        except Exception as e:
            log.exception("upload_urls: %s", e)
            return {"url": url, "ok": False, "error": str(e)}
        finally:
            if tmp_path:
                try:
                    os.remove(tmp_path)
                except Exception:
                    pass

    workers = max(1, min(max_workers, len(urls)))
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futures = {ex.submit(_worker, u): u for u in urls}
        for fut in as_completed(futures):
            res = fut.result()
            results["details"].append(res)
            if res.get("ok"):
                results["uploaded"] += 1
            elif res.get("skipped"):
                results["skipped"] += 1
            else:
                results["errors"].append(res)

    return results


def upload_urls_with_progress(
    blob_svc: BlobServiceClient,
    project_code: str,
    project_name: str,
    urls: List[str],
    progress_cb: Callable,
    prefijo: Optional[str] = None,
    max_workers: int = 4,
) -> Dict[str, Any]:
    """
    Como upload_urls pero reporta progreso via progress_cb.

    progress_cb(file_index: int, event: str, payload: dict)
    Eventos: 'queued', 'downloading', 'downloaded', 'uploading', 'uploaded', 'error', 'finished'
    """
    week = _week_iso_for_date()
    carpeta = _resolve_carpeta(project_code, project_name)

    results: Dict[str, Any] = {"uploaded": 0, "skipped": 0, "errors": [], "details": []}

    container = blob_svc.get_container_client(CONTAINER_NAME)
    blob_index = construir_blob_index(blob_svc, prefix=carpeta)

    def _worker(idx: int, url: str) -> Dict[str, Any]:
        progress_cb(idx, "queued", {"url": url})
        name = _guess_filename_from_url(url)
        tmp_path = None
        try:
            # Resolver UNA sola vez (nombre + URL real de descarga) y verificar
            # existencia ANTES de descargar: no bajamos gigas para luego omitir.
            download_url, name = _resolve_download_url(url)
            blob_path = f"{carpeta}/{week}/{name}"
            if blob_path in blob_index:
                progress_cb(idx, "skipped", {"name": name, "blob": blob_path})
                return {"url": url, "ok": False, "skipped": True, "blob": blob_path}

            with tempfile.NamedTemporaryFile(delete=False) as tmpf:
                tmp_path = tmpf.name
            name, ct, downloaded = _download_stream_to_tempfile(download_url, name, tmp_path, progress_cb, idx)
            progress_cb(idx, "downloaded", {"name": name, "size": downloaded})

            progress_cb(idx, "uploading", {"name": name, "size": downloaded})
            _upload_file_in_blocks(container, blob_path, tmp_path, ct, progress_cb, idx)
            progress_cb(idx, "uploaded", {"name": name, "blob": blob_path, "size": downloaded})
            return {"url": url, "ok": True, "blob": blob_path, "size": downloaded}

        except Exception as e:
            log.exception("upload_urls_with_progress: %s", e)
            progress_cb(idx, "error", {"name": name, "error": str(e)})
            return {"url": url, "ok": False, "error": str(e)}
        finally:
            if tmp_path:
                try:
                    os.remove(tmp_path)
                except Exception:
                    pass

    workers = max(1, min(max_workers, len(urls)))
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futures = {ex.submit(_worker, i, u): (i, u) for i, u in enumerate(urls)}
        for fut in as_completed(futures):
            res = fut.result()
            results["details"].append(res)
            if res.get("ok"):
                results["uploaded"] += 1
            elif res.get("skipped"):
                results["skipped"] += 1
            else:
                results["errors"].append(res)

    progress_cb(-1, "finished", {"summary": results})
    return results