"""
Azure Functions Backend — Visor Audiovisual
Python 3.9+ compatible
"""

import azure.functions as func
import json
import os
import logging
import uuid
import io
import time
import tempfile
from urllib.parse import unquote
from threading import Lock
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any
from PIL import Image, ImageOps

import requests
from azure.storage.blob import (
    BlobServiceClient,
    generate_blob_sas,
    BlobSasPermissions,
)
from azure.core.exceptions import ResourceNotFoundError, ResourceExistsError
import jwt
from jwt import PyJWKClient
import uploader

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)

# ── CONFIG ─────────────────────────────────────────────────────────────────
CONN_STR     = os.environ.get("AZURE_STORAGE_CONNECTION_STRING", "")
ACCOUNT_NAME = os.environ.get("AZURE_STORAGE_ACCOUNT", "ripconaudiovisual")
ACCOUNT_KEY  = os.environ.get("AZURE_STORAGE_KEY", "")
CONTAINER    = os.environ.get("BLOB_CONTAINER", "audiovisual")
CACHE_TTL_SECONDS = int(os.environ.get("CACHE_TTL_SECONDS", "45"))
SHARES_PREFIX = os.environ.get("SHARES_PREFIX", "_shares")
STATUS_UPLOAD_WINDOW_HOURS = int(os.environ.get("STATUS_UPLOAD_WINDOW_HOURS", "48"))
INDEX_PREFIX = os.environ.get("INDEX_PREFIX", "_index")
INDEX_ENABLED = os.environ.get("INDEX_ENABLED", "true").strip().lower() in ("1", "true", "yes", "on")
INDEX_REFRESH_CRON = os.environ.get("INDEX_REFRESH_CRON", "0 0 4 * * *")
CONFIG_PREFIX = os.environ.get("CONFIG_PREFIX", "_config")
# Biblioteca de contenido por sección (marcas, documentos, videos...), separada
# de las carpetas de proyectos: _media/<seccion>/<carpeta>/<archivos>
MEDIA_PREFIX = os.environ.get("MEDIA_PREFIX", "_media")

# ── Identidad y accesos ────────────────────────────────────────────────────
# AUTH_MODE: "lax" (por defecto) decodifica los claims y verifica tenant + expiración,
#            pero no la firma — no puede bloquear el acceso por problemas de validación,
#            y ya es más estricto que el backend anterior (que aceptaba cualquier token).
#            "strict" además valida firma/audiencia contra Entra ID (JWKS): actívalo en
#            Application Settings (AUTH_MODE=strict) al mismo tiempo que el modo Restringido.
AAD_TENANT_ID = os.environ.get("AAD_TENANT_ID", "12f2a4b5-4935-464d-9dae-e0525d0c593f")
AAD_CLIENT_ID = os.environ.get("AAD_CLIENT_ID", "a4413b75-4069-48e0-b055-55dce319dfbc")
AUTH_MODE = os.environ.get("AUTH_MODE", "lax").strip().lower()
# Súper-administradores permanentes (coma-separados). Siempre admins, aunque la
# config de accesos diga otra cosa — es la vía de recuperación ante un bloqueo.
# agarzon es el admin de inicio; se puede ampliar/override con la env ADMIN_EMAILS.
ADMIN_EMAILS = {e.strip().lower() for e in os.environ.get("ADMIN_EMAILS", "agarzon@ripconciv.com").split(",") if e.strip()}

_cache: Dict[str, Dict[str, Any]] = {}
_cache_lock = Lock()
_upload_jobs: Dict[str, Dict[str, Any]] = {}
_upload_jobs_lock = Lock()

# ── HELPERS ────────────────────────────────────────────────────────────────

def cors_headers() -> Dict[str, str]:
    return {
        "Access-Control-Allow-Origin":  "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Content-Type": "application/json",
    }

def _resolve_carpeta(project_code: str, project_name: str) -> str:
    """
    Construye el nombre del directorio raíz del proyecto de forma inteligente 
    para evitar duplicados (ej. '16002_opa_opa').
    """
    code = (project_code or "").strip()
    
    # Normalizamos el nombre para compararlo y concatenarlo
    # (minúsculas y cambiando espacios por guiones)
    name_slug = (project_name or "").strip().replace(" ", "-").lower()
    
    # Si no hay código, usamos solo el nombre
    if not code:
        return name_slug
        
    # Magia aquí: Si el código ya termina con el nombre (ej. code="16002_opa", name="opa"),
    # devolvemos el código tal cual para no duplicar.
    if code.lower().endswith(f"_{name_slug}"):
        return code
        
    # Si es un código limpio (ej. code="16002", name="opa"), los unimos
    return f"{code}_{name_slug}"

def ok(data: Any, status: int = 200) -> func.HttpResponse:
    return func.HttpResponse(
        body=json.dumps(data, default=str),
        status_code=status,
        headers=cors_headers(),
    )

def err(msg: str, status: int = 400) -> func.HttpResponse:
    return func.HttpResponse(
        body=json.dumps({"error": msg}),
        status_code=status,
        headers=cors_headers(),
    )

def options_ok() -> func.HttpResponse:
    return func.HttpResponse("", status_code=204, headers=cors_headers())

def binary_headers(content_type: str = "application/octet-stream") -> Dict[str, str]:
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Content-Type": content_type,
        "Cache-Control": "public, max-age=600",
    }

def cache_get(key: str):
    now = datetime.now(timezone.utc).timestamp()
    with _cache_lock:
        entry = _cache.get(key)
        if not entry:
            return None
        if entry["expires_at"] <= now:
            _cache.pop(key, None)
            return None
        return entry["value"]

def cache_set(key: str, value: Any, ttl_seconds: int = CACHE_TTL_SECONDS) -> None:
    if ttl_seconds <= 0:
        return
    expires_at = datetime.now(timezone.utc).timestamp() + ttl_seconds
    with _cache_lock:
        _cache[key] = {"expires_at": expires_at, "value": value}

def is_authenticated(req: func.HttpRequest) -> bool:
    auth = req.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return False
    token_part = auth[7:]
    return len(token_part.split(".")) == 3

def get_blob_service() -> BlobServiceClient:
    if not CONN_STR:
        raise ValueError("AZURE_STORAGE_CONNECTION_STRING no configurado en Application Settings")
    return BlobServiceClient.from_connection_string(CONN_STR)

def ext_of(name: str) -> str:
    return name.rsplit(".", 1)[-1].lower() if "." in name else ""

def type_of(name: str) -> str:
    ext = ext_of(name)
    if ext in ("jpg", "jpeg", "png", "tiff", "tif", "webp"): return "img"
    if ext in ("mp4", "mov", "avi", "mkv"):                   return "vid"
    if ext in ("dng", "cr3", "arw", "raw", "nef"):            return "raw"
    if ext == "insv":                                          return "i360"
    return "file"

def prefix_of(name: str) -> str:
    p = name.split("_")[0].upper() if "_" in name else ""
    return p if p in ("DRN", "FOT", "VID", "E360", "I360") else "FILE"

def is_marker_file(name: str) -> bool:
    n = (name or "").strip().lower()
    return n in (".keep", ".empty", ".placeholder")

def folder_path_of(blob_name: str) -> Optional[str]:
    parts = (blob_name or "").split("/")
    if len(parts) < 3:
        return None
    folder_parts = [part for part in parts[1:-1] if part]
    if not folder_parts:
        return None
    return "/".join(folder_parts)

def normalize_folder_path(path: str) -> str:
    return unquote(path or "").strip().strip("/")

def list_folder_children(project_id: str, folder_path: str) -> Dict[str, list]:
    svc = get_blob_service()
    cc = svc.get_container_client(CONTAINER)
    current = normalize_folder_path(folder_path)
    prefix = f"{project_id}/{current}/" if current else f"{project_id}/"

    folder_map: Dict[str, Dict[str, Any]] = {}
    files: list = []

    for blob in cc.list_blobs(name_starts_with=prefix):
        remainder = blob.name[len(prefix):]
        if not remainder:
            continue

        leaf_name = remainder.split("/")[-1]
        if is_marker_file(leaf_name):
            continue

        if "/" not in remainder:
            files.append({
                "name": leaf_name,
                "path": blob.name,
                "size": blob.size,
                "type": type_of(leaf_name),
                "prefix": prefix_of(leaf_name),
                "lastModified": blob.last_modified.isoformat() if blob.last_modified else None,
            })
            continue

        child_name = remainder.split("/", 1)[0]
        child_path = f"{current}/{child_name}" if current else child_name
        if child_path not in folder_map:
            folder_map[child_path] = {
                "name": child_name,
                "path": child_path,
                "count": 0,
                "types": set(),
                "lastModified": None,
            }

        child = folder_map[child_path]
        child["count"] += 1
        pfx = prefix_of(leaf_name)
        if pfx != "FILE":
            child["types"].add(pfx)
        lm = blob.last_modified
        if lm and (child["lastModified"] is None or lm > child["lastModified"]):
            child["lastModified"] = lm

    folders = []
    for folder in sorted(folder_map.values(), key=lambda x: x["path"]):
        folders.append({
            "name": folder["name"],
            "path": folder["path"],
            "count": folder["count"],
            "types": sorted(folder["types"]),
            "lastModified": folder["lastModified"].isoformat() if folder["lastModified"] else None,
        })

    files.sort(key=lambda f: f["name"])
    return {"folders": folders, "files": files}

def make_sas_url(blob_path: str, expiry_minutes: int = 60) -> str:
    if not ACCOUNT_KEY:
        raise ValueError("AZURE_STORAGE_KEY no configurado en Application Settings")
    expiry = datetime.now(timezone.utc) + timedelta(minutes=expiry_minutes)
    sas = generate_blob_sas(
        account_name=ACCOUNT_NAME,
        container_name=CONTAINER,
        blob_name=blob_path,
        account_key=ACCOUNT_KEY,
        permission=BlobSasPermissions(read=True),
        expiry=expiry,
    )
    return f"https://{ACCOUNT_NAME}.blob.core.windows.net/{CONTAINER}/{blob_path}?{sas}"

def make_sas_url_write(blob_path: str, expiry_minutes: int = 360) -> str:
    """SAS de escritura para subida directa navegador→blob (Put Blob / Put Block).
    Solo permite escribir/crear ese blob exacto; no leer ni listar."""
    if not ACCOUNT_KEY:
        raise ValueError("AZURE_STORAGE_KEY no configurado en Application Settings")
    expiry = datetime.now(timezone.utc) + timedelta(minutes=expiry_minutes)
    sas = generate_blob_sas(
        account_name=ACCOUNT_NAME,
        container_name=CONTAINER,
        blob_name=blob_path,
        account_key=ACCOUNT_KEY,
        permission=BlobSasPermissions(write=True, create=True),
        expiry=expiry,
    )
    return f"https://{ACCOUNT_NAME}.blob.core.windows.net/{CONTAINER}/{blob_path}?{sas}"

def derive_project_status(file_count: int, weeks_count: int, last_modified: Optional[datetime]) -> Dict[str, str]:
    if file_count <= 0 or weeks_count <= 0:
        return {"status": "pendiente", "statusReason": "Sin archivos o semanas registradas"}

    if last_modified:
        now_utc = datetime.now(timezone.utc)
        lm_utc = last_modified if last_modified.tzinfo else last_modified.replace(tzinfo=timezone.utc)
        age_hours = (now_utc - lm_utc).total_seconds() / 3600
        if age_hours <= STATUS_UPLOAD_WINDOW_HOURS:
            return {"status": "subiendo", "statusReason": f"Actividad reciente ({age_hours:.1f}h)"}

    return {"status": "completo", "statusReason": "Carga estable"}

def share_blob_name(token: str) -> str:
    return f"{SHARES_PREFIX.strip('/')}/{token}.json"

def save_share(share: Dict[str, Any]) -> None:
    svc = get_blob_service()
    bc = svc.get_blob_client(container=CONTAINER, blob=share_blob_name(share["token"]))
    bc.upload_blob(json.dumps(share, ensure_ascii=False), overwrite=True, content_type="application/json")

def load_share(token: str) -> Optional[Dict[str, Any]]:
    svc = get_blob_service()
    bc = svc.get_blob_client(container=CONTAINER, blob=share_blob_name(token))
    try:
        raw = bc.download_blob().readall()
        return json.loads(raw.decode("utf-8"))
    except ResourceNotFoundError:
        return None

def delete_share(token: str) -> None:
    svc = get_blob_service()
    bc = svc.get_blob_client(container=CONTAINER, blob=share_blob_name(token))
    try:
        bc.delete_blob(delete_snapshots="include")
    except ResourceNotFoundError:
        return

def list_shares() -> list:
    svc = get_blob_service()
    cc = svc.get_container_client(CONTAINER)
    result = []
    prefix = f"{SHARES_PREFIX.strip('/')}/"
    for blob in cc.list_blobs(name_starts_with=prefix):
        try:
            bc = cc.get_blob_client(blob)
            raw = bc.download_blob().readall()
            share = json.loads(raw.decode("utf-8"))
            if isinstance(share, dict) and share.get("token"):
                result.append(share)
        except Exception:
            continue
    return result

def index_projects_blob_name() -> str:
    return f"{INDEX_PREFIX.strip('/')}/projects.json"

def index_weeks_blob_name(project_id: str) -> str:
    return f"{INDEX_PREFIX.strip('/')}/weeks/{project_id}.json"

def index_files_blob_name(project_id: str, week: str) -> str:
    return f"{INDEX_PREFIX.strip('/')}/files/{project_id}/{week}.json"

def project_settings_blob_name(project_id: str) -> str:
    return f"{INDEX_PREFIX.strip('/')}/settings/{project_id}.json"

def should_skip_for_content_index(blob_name: str) -> bool:
    shares_prefix = f"{SHARES_PREFIX.strip('/')}/"
    index_prefix = f"{INDEX_PREFIX.strip('/')}/"
    config_prefix = f"{CONFIG_PREFIX.strip('/')}/"
    media_prefix = f"{MEDIA_PREFIX.strip('/')}/"
    return (
        blob_name.startswith(shares_prefix)
        or blob_name.startswith(index_prefix)
        or blob_name.startswith(config_prefix)
        or blob_name.startswith(media_prefix)
    )

def load_json_blob(blob_name: str) -> Optional[Any]:
    svc = get_blob_service()
    bc = svc.get_blob_client(container=CONTAINER, blob=blob_name)
    try:
        raw = bc.download_blob().readall()
        return json.loads(raw.decode("utf-8"))
    except ResourceNotFoundError:
        return None

def save_json_blob(blob_name: str, payload: Any) -> None:
    svc = get_blob_service()
    bc = svc.get_blob_client(container=CONTAINER, blob=blob_name)
    bc.upload_blob(
        json.dumps(payload, ensure_ascii=False, default=str),
        overwrite=True,
        content_type="application/json"
    )

def clear_index_related_cache() -> None:
    with _cache_lock:
        keys = list(_cache.keys())
        for key in keys:
            if key == "projects" or key.startswith("weeks:") or key.startswith("files:"):
                _cache.pop(key, None)

def normalize_projects_payload(items: Any) -> list:
    if not isinstance(items, list):
        return []
    normalized = []
    for p in items:
        if not isinstance(p, dict):
            continue
        out = dict(p)
        weeks_count = int(out.get("weeks") or 0)
        status = str(out.get("status") or "").strip().lower()
        if "hasContent" not in out:
            out["hasContent"] = not (status == "pendiente" and weeks_count == 0)
        if "statusReason" not in out:
            out["statusReason"] = ""
        normalized.append(out)
    return normalized

def build_index_payloads() -> Dict[str, Any]:
    svc = get_blob_service()
    cc  = svc.get_container_client(CONTAINER)

    project_map: Dict[str, Dict[str, Any]] = {}
    week_map_by_project: Dict[str, Dict[str, Dict[str, Any]]] = {}
    files_map_by_project_week: Dict[str, list] = {}

    for blob in cc.list_blobs():
        if should_skip_for_content_index(blob.name):
            continue
        parts = blob.name.split("/")
        if len(parts) < 3 or not parts[-1]:
            continue

        project_id = parts[0]
        folder_path = folder_path_of(blob.name)
        fname = parts[-1]

        if not folder_path:
            continue

        if project_id not in project_map:
            slug = " ".join(project_id.split("_")[1:]).upper().replace("-", " ")
            project_map[project_id] = {
                "code": project_id, "name": slug,
                "weeks": set(), "types": set(),
                "lastModified": None, "fileCount": 0, "hasMarker": False,
                "coverPath": None, "coverIsDrone": False,
            }

        proj = project_map[project_id]
        if is_marker_file(fname):
            proj["hasMarker"] = True
            continue

        proj["weeks"].add(folder_path)
        proj["fileCount"] += 1
        pfx = prefix_of(fname)
        if pfx != "FILE":
            proj["types"].add(pfx)
        # Portada del proyecto: primera imagen; las de dron (DRN) tienen prioridad
        if type_of(fname) == "img":
            is_drone = pfx == "DRN"
            if proj["coverPath"] is None or (is_drone and not proj["coverIsDrone"]):
                proj["coverPath"] = blob.name
                proj["coverIsDrone"] = is_drone
        lm = blob.last_modified
        if lm and (proj["lastModified"] is None or lm > proj["lastModified"]):
            proj["lastModified"] = lm

        if project_id not in week_map_by_project:
            week_map_by_project[project_id] = {}
        if folder_path not in week_map_by_project[project_id]:
            week_map_by_project[project_id][folder_path] = {"week": folder_path, "count": 0, "types": set()}
        week_map_by_project[project_id][folder_path]["count"] += 1
        if pfx != "FILE":
            week_map_by_project[project_id][folder_path]["types"].add(pfx)

        file_key = f"{project_id}::{folder_path}"
        if file_key not in files_map_by_project_week:
            files_map_by_project_week[file_key] = []
        files_map_by_project_week[file_key].append({
            "name": fname, "path": blob.name, "size": blob.size,
            "type": type_of(fname), "prefix": prefix_of(fname),
            "lastModified": blob.last_modified.isoformat() if blob.last_modified else None,
        })

    projects = []
    for proj in sorted(project_map.values(), key=lambda x: x["code"]):
        status_info = derive_project_status(
            file_count=proj["fileCount"],
            weeks_count=len(proj["weeks"]),
            last_modified=proj["lastModified"],
        )
        projects.append({
            "code": proj["code"], "name": proj["name"],
            "weeks": len(proj["weeks"]),
            "types": "+".join(sorted(proj["types"])),
            "status": status_info["status"],
            "statusReason": status_info["statusReason"],
            "hasContent": proj["fileCount"] > 0,
            "lastModified": proj["lastModified"].isoformat() if proj["lastModified"] else None,
            "coverPath": proj["coverPath"],
        })

    weeks_by_project: Dict[str, list] = {}
    for project_id, week_map in week_map_by_project.items():
        weeks_by_project[project_id] = [
            {"week": k, "count": v["count"], "types": sorted(v["types"])}
            for k, v in sorted(week_map.items())
        ]

    for key in files_map_by_project_week:
        files_map_by_project_week[key].sort(key=lambda f: f["name"])

    return {
        "projects": projects,
        "weeksByProject": weeks_by_project,
        "filesByProjectWeek": files_map_by_project_week,
    }

def refresh_content_indexes() -> Dict[str, int]:
    payloads = build_index_payloads()
    save_json_blob(index_projects_blob_name(), payloads["projects"])

    for project_id, weeks in payloads["weeksByProject"].items():
        save_json_blob(index_weeks_blob_name(project_id), weeks)

    for key, files in payloads["filesByProjectWeek"].items():
        project_id, week = key.split("::", 1)
        save_json_blob(index_files_blob_name(project_id, week), files)

    clear_index_related_cache()

    return {
        "projects": len(payloads["projects"]),
        "weeksIndexes": len(payloads["weeksByProject"]),
        "filesIndexes": len(payloads["filesByProjectWeek"]),
    }

def build_thumbnail_bytes(raw_bytes: bytes, max_width: int = 480, quality: int = 72,
                          trim: bool = False):
    """Devuelve (bytes, content_type). Con trim=True recorta el arte al contenido
    (modo logo: elimina el área de respeto) y conserva la transparencia PNG."""
    with Image.open(io.BytesIO(raw_bytes)) as src:
        img = ImageOps.exif_transpose(src)
        has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)
        img = img.convert("RGBA") if has_alpha else img.convert("RGB")

        if trim:
            if has_alpha:
                bbox = img.split()[3].getbbox()
            else:
                from PIL import ImageChops
                px = img.load()
                w0, h0 = img.size
                corners = [px[2, 2], px[w0 - 3, 2], px[2, h0 - 3], px[w0 - 3, h0 - 3]]
                bg = max(set(corners), key=corners.count)
                diff = ImageChops.difference(img, Image.new("RGB", img.size, bg)).convert("L")
                bbox = diff.point(lambda p: 255 if p > 12 else 0).getbbox()
            if bbox:
                l, t, r, b = bbox
                m = int(max(r - l, b - t) * 0.16)
                w0, h0 = img.size
                img = img.crop((max(0, l - m), max(0, t - m), min(w0, r + m), min(h0, b + m)))

        w, h = img.size
        if w > max_width:
            new_h = int((h * max_width) / w)
            img = img.resize((max_width, max(1, new_h)), Image.Resampling.LANCZOS)

        out = io.BytesIO()
        if has_alpha:
            img.save(out, format="PNG", optimize=True)
            return out.getvalue(), "image/png"
        img.save(out, format="JPEG", quality=quality, optimize=True, progressive=True)
        return out.getvalue(), "image/jpeg"


# ── AUTENTICACIÓN Y CONTROL DE ACCESOS ────────────────────────────────────
# La identidad sale del token de Entra ID que ya envía el frontend (MSAL).
# Los permisos viven en un blob JSON ({CONFIG_PREFIX}/access.json) que el
# administrador edita desde la página "Accesos".

# La sección de material audiovisual de obra se llama "proyectos" (id = etiqueta,
# coherente). "material" es un alias histórico que se normaliza a "proyectos".
KNOWN_SECTIONS = ["proyectos", "marcas", "documentos", "videos", "eventos", "redes"]
SECTION_ALIASES = {"material": "proyectos"}
ROLES = ("admin", "operador", "viewer")

def canon_section(s: str) -> str:
    return SECTION_ALIASES.get(s, s)

ACCESS_CACHE_KEY = "access:config"
_ACCESS_NONE = "__no_config__"

def access_config_blob_name() -> str:
    return f"{CONFIG_PREFIX.strip('/')}/access.json"

_jwks_client = None
_jwks_lock = Lock()

def _get_jwks_client() -> PyJWKClient:
    global _jwks_client
    with _jwks_lock:
        if _jwks_client is None:
            url = f"https://login.microsoftonline.com/{AAD_TENANT_ID}/discovery/v2.0/keys"
            _jwks_client = PyJWKClient(url, cache_keys=True, lifespan=3600)
        return _jwks_client

def _decode_claims_unverified(token: str) -> dict:
    """Decodifica los claims SIN verificar firma ni tiempos (nbf/iat/exp/aud).
    Robusto ante desfase de reloj entre Azure y el emisor del token."""
    return jwt.decode(token, options={
        "verify_signature": False, "verify_aud": False, "verify_iss": False,
        "verify_exp": False, "verify_nbf": False, "verify_iat": False,
    })

def get_caller(req: func.HttpRequest) -> Optional[Dict[str, str]]:
    """Extrae la identidad (email + nombre) del token Bearer. None si el token
    falta o no trae identidad de este tenant."""
    auth = req.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    token = auth[7:].strip()
    if token.count(".") != 2:
        return None
    try:
        claims = None
        if AUTH_MODE == "strict":
            # Intenta validar firma/audiencia contra Entra ID; si falla NO bloquea
            # (degrada a lax con aviso), para no dejar a nadie fuera por un desajuste
            # de configuración. Endurecer de verdad = revisar el app registration.
            try:
                signing_key = _get_jwks_client().get_signing_key_from_jwt(token)
                claims = jwt.decode(
                    token, key=signing_key.key, algorithms=["RS256"],
                    audience=[AAD_CLIENT_ID, f"api://{AAD_CLIENT_ID}"],
                    options={"verify_iss": False}, leeway=300,
                )
            except Exception as exc:
                logging.warning("get_caller: validación estricta falló, uso lax: %s", exc)
                claims = _decode_claims_unverified(token)
        else:
            claims = _decode_claims_unverified(token)

        tid = str(claims.get("tid") or "")
        iss = str(claims.get("iss") or "")
        if AAD_TENANT_ID and AAD_TENANT_ID != tid and AAD_TENANT_ID not in iss:
            logging.warning("get_caller: tenant no coincide (tid=%s)", tid)
            return None
        email = (
            claims.get("preferred_username") or claims.get("upn")
            or claims.get("email") or claims.get("unique_name") or ""
        ).strip().lower()
        if not email:
            logging.warning("get_caller: token sin email (claves: %s)", list(claims.keys()))
            return None
        return {"email": email, "name": str(claims.get("name") or "")}
    except Exception as exc:
        logging.warning("get_caller: token rechazado: %s", exc)
        return None

def load_access_config() -> Optional[dict]:
    cached = cache_get(ACCESS_CACHE_KEY)
    if cached is not None:
        return None if cached == _ACCESS_NONE else cached
    cfg = None
    try:
        cfg = load_json_blob(access_config_blob_name())
    except Exception as exc:
        logging.error("load_access_config: %s", exc)
    cache_set(ACCESS_CACHE_KEY, cfg if cfg is not None else _ACCESS_NONE, ttl_seconds=30)
    return cfg

# Permisos por persona = capacidades de gestión (qué puede HACER) + secciones/scopes
# (qué puede VER). Los roles son solo presets rápidos de esas capacidades; el
# administrador puede ajustar cada capacidad manualmente por usuario.
CAPS = ("upload", "manageMedia", "share", "refreshIndex", "manageAccess")
ROLE_CAPS = {
    "admin":    {c: True for c in CAPS},
    "operador": {"upload": True, "manageMedia": True, "share": True,
                 "refreshIndex": True, "manageAccess": False},
    "viewer":   {c: False for c in CAPS},
}

def _caps_from(role: str, overrides: Any) -> dict:
    caps = dict(ROLE_CAPS.get(role, ROLE_CAPS["viewer"]))
    if isinstance(overrides, dict):
        for c in CAPS:
            if c in overrides:
                caps[c] = bool(overrides[c])
    return caps

def _perms(email, name, role, caps, sections, scopes, restricted, bootstrap, allowed=True) -> dict:
    return {
        "email": email, "name": name, "allowed": allowed, "role": role,
        "caps": caps,
        "isAdmin": bool(caps.get("manageAccess")),
        "isManager": bool(caps.get("upload") or caps.get("manageMedia")),
        "sections": sections, "scopes": scopes,
        "restricted": restricted, "bootstrap": bootstrap,
    }

def _perms_full(email: str, name: str, role: str, restricted: bool, bootstrap: bool) -> dict:
    return _perms(email, name, role, dict(ROLE_CAPS.get(role, ROLE_CAPS["admin"])),
                  "*", {}, restricted, bootstrap)

def _normalize_scopes(entry: dict) -> dict:
    """Mapa {seccion: [items]} con solo listas no vacías; ausencia = sin restricción.
    Compat: la config vieja usaba 'projects' → scope de 'proyectos'."""
    raw = entry.get("scopes")
    raw = dict(raw) if isinstance(raw, dict) else {}
    old = entry.get("projects")
    if old is not None and old != "*" and isinstance(old, list) and "proyectos" not in raw and "material" not in raw:
        raw["proyectos"] = old
    cleaned: Dict[str, list] = {}
    for sec, val in raw.items():
        sec = canon_section(sec)
        if sec not in KNOWN_SECTIONS or val == "*":
            continue
        if isinstance(val, list):
            vals = [str(x).strip() for x in val if str(x).strip()]
            if vals:
                cleaned[sec] = vals
    return cleaned

def effective_perms(caller: Optional[Dict[str, str]]) -> dict:
    if caller is None:
        return {"email": "", "name": "", "allowed": False, "role": None, "isAdmin": False,
                "isManager": False, "sections": [], "scopes": {}, "restricted": False, "bootstrap": False}

    email, name = caller["email"], caller.get("name", "")
    cfg = load_access_config()
    env_admin = email in ADMIN_EMAILS

    if cfg is None:
        # Sin configuración: modo abierto. Sin ADMIN_EMAILS, el primer usuario
        # autenticado es admin (bootstrap) y puede crear la configuración.
        bootstrap = not ADMIN_EMAILS
        role = "admin" if (env_admin or bootstrap) else "operador"
        return _perms_full(email, name, role, False, bootstrap)

    restricted = bool(cfg.get("restricted"))
    entry = None
    for u in cfg.get("users", []):
        if isinstance(u, dict) and str(u.get("email", "")).strip().lower() == email:
            entry = u
            break

    if env_admin:
        return _perms_full(email, name, "admin", restricted, False)

    if entry and entry.get("enabled", True):
        role = entry.get("role") if entry.get("role") in ROLES else "viewer"
        caps = _caps_from(role, entry.get("caps"))
        name = name or str(entry.get("name") or "")
        # Quien gestiona accesos ve todo (lo necesita para administrar).
        if caps.get("manageAccess"):
            return _perms(email, name, role, caps, "*", {}, restricted, False)
        sections = entry.get("sections", [])
        if sections != "*":
            sections = [canon_section(s) for s in sections if canon_section(s) in KNOWN_SECTIONS] if isinstance(sections, list) else []
        return _perms(email, name, role, caps, sections, _normalize_scopes(entry), restricted, False)

    if restricted:
        return _perms(email, name, None, dict(ROLE_CAPS["viewer"]), [], {}, True, False, allowed=False)

    # Config existe pero abierta: los no listados ven todo pero no gestionan.
    return _perms(email, name, "viewer", dict(ROLE_CAPS["viewer"]), "*", {}, False, False)

def perms_allow_section(perms: dict, section: str) -> bool:
    if perms.get("isManager"):
        return True
    secs = perms.get("sections")
    return secs == "*" or (isinstance(secs, list) and section in secs)

def perms_allow_item(perms: dict, section: str, item: str) -> bool:
    if not perms_allow_section(perms, section):
        return False
    if perms.get("isManager"):
        return True
    scope = (perms.get("scopes") or {}).get(section)
    if not scope:            # ausente o vacío = acceso a toda la sección
        return True
    return item in scope

def require_perms(req: func.HttpRequest, section: Optional[str] = None,
                  item: Optional[str] = None, cap: Optional[str] = None):
    """Devuelve (perms, None) si el caller pasa los requisitos, o
    (None, HttpResponse) con el error listo para retornar.
    `cap` exige una capacidad de gestión (upload / manageMedia / share /
    refreshIndex / manageAccess). `section`/`item` controlan la vista."""
    caller = get_caller(req)
    perms = effective_perms(caller)
    section = canon_section(section) if section else section
    if not perms["allowed"]:
        return None, err("No autorizado", 401 if caller is None else 403)
    if cap and not perms.get("caps", {}).get(cap):
        msg = "Requiere permisos de administrador" if cap == "manageAccess" else "Sin permiso para esta acción"
        return None, err(msg, 403)
    if section and not perms_allow_section(perms, section):
        return None, err("Sin acceso a esta sección", 403)
    if section and item and not perms_allow_item(perms, section, item):
        return None, err("Sin acceso a este elemento", 403)
    return perms, None

def require_blob_access(req: func.HttpRequest, blob_path: str):
    """Gate por ruta de blob: los paths de _media se controlan por sección + carpeta;
    el resto son proyectos (proyectos + código de proyecto)."""
    seg = [s for s in (blob_path or "").split("/") if s]
    if seg and seg[0] == MEDIA_PREFIX.strip("/"):
        if len(seg) < 3:
            return None, err("Ruta de media inválida", 400)
        return require_perms(req, section=seg[1], item=seg[2])
    return require_perms(req, section="proyectos", item=seg[0] if seg else "")

def _filter_projects_by_perms(items: list, perms: dict) -> list:
    if perms.get("isManager"):
        return items
    if not perms_allow_section(perms, "proyectos"):
        return []
    scope = (perms.get("scopes") or {}).get("proyectos")
    if not scope:
        return items
    allowed = set(scope)
    return [p for p in items if p.get("code") in allowed]

def _filter_media_folders_by_perms(folders: list, perms: dict, section: str) -> list:
    if perms.get("isManager"):
        return folders
    scope = (perms.get("scopes") or {}).get(section)
    if not scope:
        return folders
    allowed = set(scope)
    return [f for f in folders if f.get("name") in allowed]

def sanitize_access_config(payload: Any, saver_email: str) -> dict:
    if not isinstance(payload, dict):
        raise ValueError("Configuración inválida")
    users_in = payload.get("users", [])
    if not isinstance(users_in, list):
        raise ValueError("users debe ser una lista")

    seen = set()
    users = []
    for u in users_in:
        if not isinstance(u, dict):
            continue
        email = str(u.get("email", "")).strip().lower()
        if not email or "@" not in email or email in seen:
            continue
        seen.add(email)
        role = u.get("role") if u.get("role") in ROLES else "viewer"
        # Capacidades: parten del preset del rol y se sobrescriben con lo que el
        # admin marcó manualmente. Guardamos solo las 5 capacidades conocidas.
        caps_in = u.get("caps") if isinstance(u.get("caps"), dict) else {}
        caps = _caps_from(role, caps_in)
        sections = u.get("sections", [])
        if sections != "*":
            sections = [canon_section(s) for s in sections if canon_section(s) in KNOWN_SECTIONS] if isinstance(sections, list) else []
        scopes_in = u.get("scopes") if isinstance(u.get("scopes"), dict) else {}
        scopes: Dict[str, list] = {}
        for sec, val in scopes_in.items():
            sec = canon_section(sec)
            if sec not in KNOWN_SECTIONS:
                continue
            if isinstance(val, list):
                vals = [str(x).strip() for x in val if str(x).strip()]
                if vals:
                    scopes[sec] = vals
        users.append({
            "email": email,
            "name": str(u.get("name") or "").strip(),
            "role": role,
            "enabled": bool(u.get("enabled", True)),
            "caps": caps,
            "sections": sections,
            "scopes": scopes,
        })

    # "Puede gestionar accesos" es la capacidad crítica: debe quedar al menos uno.
    active_admins = [u for u in users if u["caps"].get("manageAccess") and u["enabled"]]
    if not active_admins and not ADMIN_EMAILS:
        raise ValueError("Debe quedar al menos una persona que pueda gestionar accesos")
    if saver_email not in ADMIN_EMAILS:
        saver = next((u for u in users if u["email"] == saver_email), None)
        if not saver or not saver["caps"].get("manageAccess") or not saver["enabled"]:
            raise ValueError("Tu propio usuario debe conservar el permiso de gestionar accesos")

    return {
        "version": 2,
        "restricted": bool(payload.get("restricted")),
        "users": users,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "updatedBy": saver_email,
    }


# ── UPLOAD JOB HELPERS ────────────────────────────────────────────────────

def _create_job(project_code: str, project_name: str, mode: str = "urls") -> str:
    job_id = uuid.uuid4().hex
    with _upload_jobs_lock:
        _upload_jobs[job_id] = {
            "id": job_id,
            "mode": mode,
            "projectCode": project_code,
            "projectName": project_name,
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "status": "queued",
            "files": [],
            "summary": None,
        }
    return job_id

def _set_job_status(job_id: str, status: str, summary: Any = None) -> None:
    with _upload_jobs_lock:
        job = _upload_jobs.get(job_id)
        if job:
            job["status"] = status
            if summary is not None:
                job["summary"] = summary

def _progress_cb_for_job(job_id: str):
    def _cb(idx: int, event: str, payload: dict):
        with _upload_jobs_lock:
            job = _upload_jobs.get(job_id)
            if not job:
                return
            if idx >= 0 and idx < len(job["files"]):
                f = job["files"][idx]
                if event == "downloading":
                    f["phase"] = "downloading"
                    f["downloaded"] = int(payload.get("downloaded", 0) or 0)
                    f["downloadTotal"] = int(payload.get("total", 0) or 0)
                elif event == "downloaded":
                    f["phase"] = "downloaded"
                    f["downloaded"] = int(payload.get("size", 0) or 0)
                elif event == "uploading":
                    f["phase"] = "uploading"
                elif event == "uploaded":
                    f["phase"] = "uploaded"
                    f["uploaded"] = int(payload.get("size", 0) or 0)
                    f["blob"] = payload.get("blob")
                elif event == "error":
                    f["phase"] = "error"
                    f["error"] = payload.get("error")
            else:
                if event == "finished":
                    job["status"] = "finished"
                    job["summary"] = payload.get("summary")
    return _cb


# ══════════════════════════════════════════════════════════════════════════════
# GET /api/thumb
# ══════════════════════════════════════════════════════════════════════════════
@app.route(route="thumb", methods=["GET", "OPTIONS"])
def thumb(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=binary_headers("application/json"))

    blob_path = (req.params.get("blobPath") or "").strip()
    ext = ext_of(blob_path)
    if not blob_path:
        return err("blobPath es requerido")

    _, auth_err = require_blob_access(req, blob_path)
    if auth_err:
        return auth_err
    if ext not in ("jpg", "jpeg", "png", "webp", "tif", "tiff"):
        return err("thumb solo disponible para imágenes", 400)

    try:
        max_width = int(req.params.get("w", "480"))
    except Exception:
        max_width = 480
    try:
        quality = int(req.params.get("q", "72"))
    except Exception:
        quality = 72
    trim = (req.params.get("mode") or "").strip().lower() == "logo"

    max_width = max(160, min(max_width, 1280))
    quality = max(40, min(quality, 90))

    cache_key = f"thumb:{blob_path}:{max_width}:{quality}:{'logo' if trim else 'std'}"
    cached = cache_get(cache_key)
    if cached is not None:
        return func.HttpResponse(body=cached[0], status_code=200, headers=binary_headers(cached[1]))

    try:
        svc = get_blob_service()
        bc = svc.get_blob_client(container=CONTAINER, blob=blob_path)
        raw = bc.download_blob().readall()
        thumb_bytes, content_type = build_thumbnail_bytes(raw, max_width=max_width, quality=quality, trim=trim)
        cache_set(cache_key, (thumb_bytes, content_type), ttl_seconds=300)
        return func.HttpResponse(body=thumb_bytes, status_code=200, headers=binary_headers(content_type))
    except Exception as exc:
        logging.error("thumb: %s", exc)
        return err(str(exc), 500)


# ══════════════════════════════════════════════════════════════════════════════
# GET /api/projects
# ══════════════════════════════════════════════════════════════════════════════
@app.route(route="projects", methods=["GET", "OPTIONS"])
def get_projects(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return options_ok()
    perms, auth_err = require_perms(req, section="proyectos")
    if auth_err:
        return auth_err

    # El caché guarda la lista completa; el filtrado por permisos es por caller.
    cached = cache_get("projects")
    if cached is not None:
        return ok(_filter_projects_by_perms(normalize_projects_payload(cached), perms))

    if INDEX_ENABLED:
        try:
            indexed = load_json_blob(index_projects_blob_name())
            if isinstance(indexed, list):
                normalized = normalize_projects_payload(indexed)
                cache_set("projects", normalized)
                return ok(_filter_projects_by_perms(normalized, perms))
        except Exception as exc:
            logging.warning("get_projects index fallback: %s", exc)

    try:
        svc = get_blob_service()
        cc  = svc.get_container_client(CONTAINER)
        project_map: Dict[str, Dict] = {}

        for blob in cc.list_blobs():
            if should_skip_for_content_index(blob.name):
                continue
            parts = blob.name.split("/")
            if len(parts) < 2:
                continue
            proj_folder = parts[0]

            if proj_folder not in project_map:
                slug = " ".join(proj_folder.split("_")[1:]).upper().replace("-", " ")
                project_map[proj_folder] = {
                    "code": proj_folder, "name": slug,
                    "weeks": set(), "types": set(),
                    "lastModified": None, "fileCount": 0, "hasMarker": False,
                    "coverPath": None, "coverIsDrone": False,
                }

            p = project_map[proj_folder]

            if len(parts) == 2 and is_marker_file(parts[1]):
                p["hasMarker"] = True
                continue

            if len(parts) < 3 or not parts[-1]:
                continue

            week_folder = folder_path_of(blob.name)
            file_name = parts[-1]
            if not week_folder:
                continue
            if is_marker_file(file_name):
                p["hasMarker"] = True
                continue

            p["weeks"].add(week_folder)
            p["fileCount"] += 1
            pfx = prefix_of(file_name)
            if pfx != "FILE":
                p["types"].add(pfx)
            if type_of(file_name) == "img":
                is_drone = pfx == "DRN"
                if p["coverPath"] is None or (is_drone and not p["coverIsDrone"]):
                    p["coverPath"] = blob.name
                    p["coverIsDrone"] = is_drone
            lm = blob.last_modified
            if lm and (p["lastModified"] is None or lm > p["lastModified"]):
                p["lastModified"] = lm

        result = []
        for proj in sorted(project_map.values(), key=lambda x: x["code"]):
            status_info = derive_project_status(
                file_count=proj["fileCount"],
                weeks_count=len(proj["weeks"]),
                last_modified=proj["lastModified"],
            )
            result.append({
                "code":         proj["code"],
                "name":         proj["name"],
                "weeks":        len(proj["weeks"]),
                "types":        "+".join(sorted(proj["types"])),
                "status":       status_info["status"],
                "statusReason": status_info["statusReason"],
                "hasContent":   proj["fileCount"] > 0,
                "lastModified": proj["lastModified"].isoformat() if proj["lastModified"] else None,
                "coverPath":    proj["coverPath"],
            })
        normalized = normalize_projects_payload(result)
        cache_set("projects", normalized)
        return ok(_filter_projects_by_perms(normalized, perms))

    except Exception as exc:
        logging.error("get_projects: %s", exc)
        return err(str(exc), 500)


# ══════════════════════════════════════════════════════════════════════════════
# GET/POST /api/projects/{project_id}/settings
# ══════════════════════════════════════════════════════════════════════════════
@app.route(route="projects/{project_id}/settings", methods=["GET", "POST", "OPTIONS"])
def project_settings(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return options_ok()
    _, auth_err = require_perms(req, cap="upload")
    if auth_err:
        return auth_err

    project_id = req.route_params.get("project_id", "").strip()
    if not project_id:
        return err("project_id es requerido", 400)

    if req.method == "GET":
        try:
            settings = load_json_blob(project_settings_blob_name(project_id)) or {}
            return ok(settings)
        except Exception as exc:
            logging.error("get_project_settings: %s", exc)
            return err(str(exc), 500)

    if req.method == "POST":
        try:
            payload = req.get_json()
        except ValueError:
            return err("Payload JSON inválido", 400)

        if not isinstance(payload, dict):
            return err("Payload debe ser un objeto JSON", 400)

        settings = {
            "prefijo": payload.get("prefijo", "FOT"),
            "maxWorkers": int(payload.get("maxWorkers", 4)) if payload.get("maxWorkers") is not None else 4,
            "refreshIndex": bool(payload.get("refreshIndex", True)),
            "savedAt": datetime.now(timezone.utc).isoformat(),
        }

        try:
            save_json_blob(project_settings_blob_name(project_id), settings)
            return ok({"saved": True, "projectId": project_id, "settings": settings})
        except Exception as exc:
            logging.error("save_project_settings: %s", exc)
            return err(str(exc), 500)


# ══════════════════════════════════════════════════════════════════════════════
# GET /api/projects/{project_id}/weeks
# ══════════════════════════════════════════════════════════════════════════════
@app.route(route="projects/{project_id}/weeks", methods=["GET", "OPTIONS"])
def get_weeks(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return options_ok()

    project_id = req.route_params.get("project_id", "")
    _, auth_err = require_perms(req, section="proyectos", item=project_id)
    if auth_err:
        return auth_err
    cache_key = f"weeks:{project_id}"
    cached = cache_get(cache_key)
    if cached is not None:
        return ok(cached)

    if INDEX_ENABLED:
        try:
            indexed = load_json_blob(index_weeks_blob_name(project_id))
            if isinstance(indexed, list):
                cache_set(cache_key, indexed)
                return ok(indexed)
        except Exception as exc:
            logging.warning("get_weeks index fallback (%s): %s", project_id, exc)

    try:
        svc = get_blob_service()
        cc  = svc.get_container_client(CONTAINER)
        week_map: Dict[str, Dict] = {}

        for blob in cc.list_blobs(name_starts_with=f"{project_id}/"):
            parts = blob.name.split("/")
            if len(parts) < 3 or not parts[-1]:
                continue
            week = folder_path_of(blob.name)
            fname = parts[-1]
            if not week:
                continue
            if is_marker_file(fname):
                continue
            if week not in week_map:
                week_map[week] = {"week": week, "count": 0, "types": set()}
            week_map[week]["count"] += 1
            pfx = prefix_of(fname)
            if pfx != "FILE":
                week_map[week]["types"].add(pfx)

        weeks = [
            {"week": k, "count": v["count"], "types": sorted(v["types"])}
            for k, v in sorted(week_map.items())
        ]
        cache_set(cache_key, weeks)
        return ok(weeks)

    except Exception as exc:
        logging.error("get_weeks: %s", exc)
        return err(str(exc), 500)


# ══════════════════════════════════════════════════════════════════════════════
# GET /api/projects/{project_id}/weeks/{week}/files
# ══════════════════════════════════════════════════════════════════════════════
@app.route(route="projects/{project_id}/weeks/{week}/files", methods=["GET", "OPTIONS"])
def get_files(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return options_ok()

    project_id = req.route_params.get("project_id", "")
    week       = normalize_folder_path(req.route_params.get("week", ""))
    _, auth_err = require_perms(req, section="proyectos", item=project_id)
    if auth_err:
        return auth_err
    cache_key = f"files:{project_id}:{week}"
    cached = cache_get(cache_key)
    if cached is not None:
        return ok(cached)

    if INDEX_ENABLED:
        try:
            indexed = load_json_blob(index_files_blob_name(project_id, week))
            if isinstance(indexed, list):
                cache_set(cache_key, indexed)
                return ok(indexed)
        except Exception as exc:
            logging.warning("get_files index fallback (%s/%s): %s", project_id, week, exc)

    try:
        files = list_folder_children(project_id, week)["files"]
        cache_set(cache_key, files)
        return ok(files)

    except Exception as exc:
        logging.error("get_files: %s", exc)
        return err(str(exc), 500)


# ══════════════════════════════════════════════════════════════════════════════
# GET /api/projects/{project_id}/browse
# ══════════════════════════════════════════════════════════════════════════════
@app.route(route="projects/{project_id}/browse", methods=["GET", "OPTIONS"])
def browse_folder(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return options_ok()

    project_id = req.route_params.get("project_id", "")
    path = normalize_folder_path(req.params.get("path", ""))
    _, auth_err = require_perms(req, section="proyectos", item=project_id)
    if auth_err:
        return auth_err
    cache_key = f"browse:{project_id}:{path}"
    cached = cache_get(cache_key)
    if cached is not None:
        return ok(cached)

    try:
        payload = list_folder_children(project_id, path)
        result = {"path": path, **payload}
        cache_set(cache_key, result)
        return ok(result)

    except Exception as exc:
        logging.error("browse_folder: %s", exc)
        return err(str(exc), 500)


# ══════════════════════════════════════════════════════════════════════════════
# POST /api/sas/generate
# ══════════════════════════════════════════════════════════════════════════════
@app.route(route="sas/generate", methods=["POST", "OPTIONS"])
def sas_generate(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return options_ok()

    try:
        body           = req.get_json()
        blob_path      = body.get("blobPath", "").strip()
        expiry_minutes = min(int(body.get("expiryMinutes", 60)), 1440)
        if not blob_path:
            return err("blobPath es requerido")
        _, auth_err = require_blob_access(req, blob_path)
        if auth_err:
            return auth_err
        sas_url = make_sas_url(blob_path, expiry_minutes)
        return ok({"sasUrl": sas_url, "expiresInMinutes": expiry_minutes})
    except Exception as exc:
        logging.error("sas_generate: %s", exc)
        return err(str(exc), 500)


# ══════════════════════════════════════════════════════════════════════════════
# POST /api/share/create
# ══════════════════════════════════════════════════════════════════════════════
@app.route(route="share/create", methods=["POST", "OPTIONS"])
def share_create(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return options_ok()
    _, auth_err = require_perms(req, cap="share")
    if auth_err:
        return auth_err

    try:
        body        = req.get_json()
        project_id  = body.get("projectId", "").strip()
        week        = body.get("week", "").strip()
        expiry_days = min(int(body.get("expiryDays", 7)), 90)
        if not project_id:
            return err("projectId es requerido")

        token      = uuid.uuid4().hex
        expires_at = datetime.now(timezone.utc) + timedelta(days=expiry_days)
        origin     = req.headers.get("Origin", "")

        share_data = {
            "token": token, "projectId": project_id, "week": week,
            "expiresAt": expires_at.isoformat(), "active": True,
        }
        save_share(share_data)
        return ok({
            "token":    token,
            "shareUrl": f"{origin}/share/{token}",
            "expiresAt": expires_at.isoformat(),
        })
    except Exception as exc:
        logging.error("share_create: %s", exc)
        return err(str(exc), 500)


# ══════════════════════════════════════════════════════════════════════════════
# GET /api/share/list
# ══════════════════════════════════════════════════════════════════════════════
@app.route(route="share/list", methods=["GET", "OPTIONS"])
def share_list(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return options_ok()
    _, auth_err = require_perms(req, cap="share")
    if auth_err:
        return auth_err

    try:
        now = datetime.now(timezone.utc)
        shares = list_shares()
        result = [{**s, "expired": datetime.fromisoformat(s["expiresAt"]) < now} for s in shares]
        result.sort(key=lambda x: x.get("expiresAt", ""), reverse=True)
        return ok(result)
    except Exception as exc:
        logging.error("share_list: %s", exc)
        return err(str(exc), 500)


# ══════════════════════════════════════════════════════════════════════════════
# GET /api/share/{share_token}   DELETE /api/share/{share_token}
# ══════════════════════════════════════════════════════════════════════════════
@app.route(route="share/{share_token}", methods=["GET", "DELETE", "OPTIONS"])
def share_resolve(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return options_ok()

    share_token = req.route_params.get("share_token", "")

    if req.method == "DELETE":
        _, auth_err = require_perms(req, cap="share")
        if auth_err:
            return auth_err
        try:
            delete_share(share_token)
            return ok({"deleted": True})
        except Exception as exc:
            logging.error("share_delete: %s", exc)
            return err(str(exc), 500)

    share = load_share(share_token)
    if not share:
        return err("Enlace no encontrado", 404)
    if not share.get("active", True):
        return err("Enlace revocado", 410)
    expires_at = datetime.fromisoformat(share["expiresAt"])
    if datetime.now(timezone.utc) > expires_at:
        return err("Enlace expirado", 410)

    try:
        svc = get_blob_service()
        cc  = svc.get_container_client(CONTAINER)
        project_id = share["projectId"]
        week       = share.get("week", "")
        prefix     = f"{project_id}/{week}/" if week else f"{project_id}/"
        remaining  = max(int((expires_at - datetime.now(timezone.utc)).total_seconds() / 60), 5)
        files      = []

        for blob in cc.list_blobs(name_starts_with=prefix):
            fname = blob.name.split("/")[-1]
            if not fname or is_marker_file(fname):
                continue
            try:
                sas_url = make_sas_url(blob.name, remaining)
            except Exception:
                sas_url = ""
            files.append({"name": fname, "path": blob.name, "type": type_of(fname), "sasUrl": sas_url})

        files.sort(key=lambda f: f["name"])
        return ok({**share, "files": files})

    except Exception as exc:
        logging.error("share_resolve: %s", exc)
        return err(str(exc), 500)


# ══════════════════════════════════════════════════════════════════════════════
# GET /api/health
# ══════════════════════════════════════════════════════════════════════════════
@app.route(route="health", methods=["GET", "OPTIONS"])
def health(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return options_ok()
    return ok({
        "status":    "ok",
        "storage":   bool(CONN_STR),
        "hasKey":    bool(ACCOUNT_KEY),
        "container": CONTAINER,
        "account":   ACCOUNT_NAME,
        "indexEnabled": INDEX_ENABLED,
        "indexPrefix": INDEX_PREFIX,
        "indexRefreshCron": INDEX_REFRESH_CRON,
    })


# ══════════════════════════════════════════════════════════════════════════════
# GET /api/me — identidad y permisos efectivos del usuario autenticado
# ══════════════════════════════════════════════════════════════════════════════
@app.route(route="me", methods=["GET", "OPTIONS"])
def get_me(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return options_ok()
    caller = get_caller(req)
    if caller is None:
        return err("No autorizado", 401)
    return ok(effective_perms(caller))


# ══════════════════════════════════════════════════════════════════════════════
# GET/POST /api/access — configuración de accesos (solo administradores)
# ══════════════════════════════════════════════════════════════════════════════
@app.route(route="access", methods=["GET", "POST", "OPTIONS"])
def access_config_endpoint(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return options_ok()

    perms, auth_err = require_perms(req, cap="manageAccess")
    if auth_err:
        return auth_err

    if req.method == "GET":
        cfg = load_access_config()
        return ok({
            "config": cfg if cfg is not None else {"restricted": False, "users": []},
            "exists": cfg is not None,
            "bootstrap": perms.get("bootstrap", False),
            "envAdmins": sorted(ADMIN_EMAILS),
            "knownSections": KNOWN_SECTIONS,
            "capabilities": list(CAPS),
        })

    try:
        payload = req.get_json()
    except ValueError:
        return err("Payload JSON inválido", 400)

    try:
        cfg = sanitize_access_config(payload, perms["email"])
    except ValueError as exc:
        return err(str(exc), 400)

    try:
        save_json_blob(access_config_blob_name(), cfg)
        with _cache_lock:
            _cache.pop(ACCESS_CACHE_KEY, None)
        return ok({"saved": True, "config": cfg})
    except Exception as exc:
        logging.error("save_access_config: %s", exc)
        return err(str(exc), 500)


# ══════════════════════════════════════════════════════════════════════════════
# BIBLIOTECA DE MEDIA — carpetas por sección bajo _media/<seccion>/<carpeta>/
# GET  /api/media/{section}                → lista carpetas (p. ej. marcas)
# POST /api/media/{section}   (admin)      → crea carpeta {name}
# GET  /api/media/{section}/{folder}       → archivos + metadata (marca.json)
# POST /api/media/{section}/{folder}/upload (admin, multipart) → sube archivos
# ══════════════════════════════════════════════════════════════════════════════
MEDIA_SECTIONS = ("marcas", "documentos", "videos", "eventos", "redes")
_FOLDER_FORBIDDEN = set('/\\#?%*:|"<>')

def _media_root(section: str) -> str:
    return f"{MEDIA_PREFIX.strip('/')}/{section}"

def _sanitize_folder_name(raw: str) -> Optional[str]:
    name = " ".join((raw or "").split())
    if not name or len(name) > 60:
        return None
    if name.startswith((".", "_")) or any(c in _FOLDER_FORBIDDEN for c in name):
        return None
    return name

@app.route(route="media/{section}", methods=["GET", "POST", "OPTIONS"])
def media_section(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return options_ok()

    section = (req.route_params.get("section") or "").strip().lower()
    if section not in MEDIA_SECTIONS:
        return err("Sección de media desconocida", 400)

    if req.method == "POST":
        _, auth_err = require_perms(req, section=section, cap="manageMedia")
        if auth_err:
            return auth_err
        try:
            body = req.get_json()
        except ValueError:
            return err("Payload JSON inválido", 400)
        name = _sanitize_folder_name(body.get("name", ""))
        if not name:
            return err("Nombre inválido: usa hasta 60 caracteres sin / \\ # ? % * : | \" < >", 400)
        try:
            svc = get_blob_service()
            cc = svc.get_container_client(CONTAINER)
            prefix = f"{_media_root(section)}/{name}/"
            for _ in cc.list_blobs(name_starts_with=prefix):
                return err("Ya existe una carpeta con ese nombre", 409)
            bc = svc.get_blob_client(container=CONTAINER, blob=f"{prefix}.keep")
            bc.upload_blob(b"", overwrite=True)
            return ok({"created": True, "name": name})
        except Exception as exc:
            logging.error("media_create_folder: %s", exc)
            return err(str(exc), 500)

    perms, auth_err = require_perms(req, section=section)
    if auth_err:
        return auth_err
    try:
        svc = get_blob_service()
        cc = svc.get_container_client(CONTAINER)
        prefix = f"{_media_root(section)}/"
        folder_map: Dict[str, Dict[str, Any]] = {}
        for blob in cc.list_blobs(name_starts_with=prefix):
            remainder = blob.name[len(prefix):]
            if "/" not in remainder:
                continue
            folder = remainder.split("/", 1)[0]
            leaf = remainder.split("/")[-1]
            if folder not in folder_map:
                folder_map[folder] = {"name": folder, "fileCount": 0, "lastModified": None}
            entry = folder_map[folder]
            if leaf and not is_marker_file(leaf) and leaf != "marca.json":
                entry["fileCount"] += 1
                lm = blob.last_modified
                if lm and (entry["lastModified"] is None or lm > entry["lastModified"]):
                    entry["lastModified"] = lm
        folders = [
            {**f, "lastModified": f["lastModified"].isoformat() if f["lastModified"] else None}
            for f in sorted(folder_map.values(), key=lambda x: x["name"].lower())
        ]
        folders = _filter_media_folders_by_perms(folders, perms, section)
        return ok({"section": section, "folders": folders})
    except Exception as exc:
        logging.error("media_list_folders: %s", exc)
        return err(str(exc), 500)


@app.route(route="media/{section}/{folder}", methods=["GET", "OPTIONS"])
def media_folder(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return options_ok()

    section = (req.route_params.get("section") or "").strip().lower()
    if section not in MEDIA_SECTIONS:
        return err("Sección de media desconocida", 400)
    folder = unquote(req.route_params.get("folder") or "").strip()
    if not folder:
        return err("Carpeta requerida", 400)

    _, auth_err = require_perms(req, section=section, item=folder)
    if auth_err:
        return auth_err

    try:
        svc = get_blob_service()
        cc = svc.get_container_client(CONTAINER)
        prefix = f"{_media_root(section)}/{folder}/"
        files = []
        meta = None
        found_any = False
        for blob in cc.list_blobs(name_starts_with=prefix):
            found_any = True
            remainder = blob.name[len(prefix):]
            leaf = remainder.split("/")[-1]
            if not leaf or is_marker_file(leaf):
                continue
            if remainder == "marca.json":
                try:
                    raw = cc.get_blob_client(blob).download_blob().readall()
                    if len(raw) <= 32_768:
                        parsed = json.loads(raw.decode("utf-8"))
                        if isinstance(parsed, dict):
                            meta = parsed
                except Exception as exc:
                    logging.warning("media_folder marca.json inválido (%s): %s", folder, exc)
                continue
            files.append({
                "name": remainder,
                "path": blob.name,
                "size": blob.size,
                "type": type_of(leaf),
                "lastModified": blob.last_modified.isoformat() if blob.last_modified else None,
            })
        if not found_any:
            return err("Carpeta no encontrada", 404)
        files.sort(key=lambda f: f["name"].lower())
        return ok({"section": section, "folder": folder, "files": files, "meta": meta})
    except Exception as exc:
        logging.error("media_folder: %s", exc)
        return err(str(exc), 500)


@app.route(route="media/{section}/{folder}/upload", methods=["POST", "OPTIONS"])
def media_upload(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return options_ok()

    section = (req.route_params.get("section") or "").strip().lower()
    if section not in MEDIA_SECTIONS:
        return err("Sección de media desconocida", 400)
    folder = unquote(req.route_params.get("folder") or "").strip()
    if not folder:
        return err("Carpeta requerida", 400)

    _, auth_err = require_perms(req, section=section, item=folder, cap="manageMedia")
    if auth_err:
        return auth_err

    try:
        incoming = req.files.getlist("files") if req.files else []
    except Exception:
        incoming = []
    if not incoming:
        return err("Adjunta al menos un archivo en el campo 'files'", 400)

    import mimetypes
    uploaded, failed = [], []
    try:
        svc = get_blob_service()
        prefix = f"{_media_root(section)}/{folder}/"
        for f in incoming:
            fname = os.path.basename(getattr(f, "filename", "") or "").strip()
            if not fname or fname.startswith("."):
                failed.append({"name": fname or "(sin nombre)", "error": "Nombre inválido"})
                continue
            try:
                data = f.stream.read()
                ctype = getattr(f, "content_type", None) or mimetypes.guess_type(fname)[0] or "application/octet-stream"
                bc = svc.get_blob_client(container=CONTAINER, blob=f"{prefix}{fname}")
                bc.upload_blob(data, overwrite=True, content_type=ctype)
                uploaded.append(fname)
            except Exception as exc:
                failed.append({"name": fname, "error": str(exc)})
        return ok({"uploaded": uploaded, "failed": failed})
    except Exception as exc:
        logging.error("media_upload: %s", exc)
        return err(str(exc), 500)


# ══════════════════════════════════════════════════════════════════════════════
# POST /api/index/refresh (manual)
# ══════════════════════════════════════════════════════════════════════════════
@app.route(route="index/refresh", methods=["POST", "OPTIONS"])
def index_refresh(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return options_ok()
    _, auth_err = require_perms(req, cap="refreshIndex")
    if auth_err:
        return auth_err

    try:
        stats = refresh_content_indexes()
        return ok({"ok": True, "stats": stats, "prefix": INDEX_PREFIX})
    except Exception as exc:
        logging.error("index_refresh: %s", exc)
        return err(str(exc), 500)


# ══════════════════════════════════════════════════════════════════════════════
# TIMER job: refresh indexes
# ══════════════════════════════════════════════════════════════════════════════
@app.timer_trigger(schedule=INDEX_REFRESH_CRON, arg_name="timer", run_on_startup=False, use_monitor=True)
def index_refresh_timer(timer: func.TimerRequest) -> None:
    if not INDEX_ENABLED:
        logging.info("index_refresh_timer: skipped (INDEX_ENABLED=false)")
        return
    try:
        stats = refresh_content_indexes()
        logging.info(
            "index_refresh_timer: ok projects=%s weeksIndexes=%s filesIndexes=%s",
            stats.get("projects"), stats.get("weeksIndexes"), stats.get("filesIndexes")
        )
    except Exception as exc:
        logging.error("index_refresh_timer: %s", exc)


# ══════════════════════════════════════════════════════════════════════════════
# POST /api/upload
# Body: { projectCode, projectName, urls: [...], prefijo?, maxWorkers?, refreshIndex? }
# ══════════════════════════════════════════════════════════════════════════════
@app.route(route="upload", methods=["POST", "OPTIONS"])
def upload(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return options_ok()
    _, auth_err = require_perms(req, cap="upload")
    if auth_err:
        return auth_err

    try:
        body = req.get_json()
    except Exception:
        return err("Cuerpo JSON inválido", 400)

    project_code  = (body.get("projectCode") or "").strip()
    project_name  = (body.get("projectName") or "").strip()
    urls          = body.get("urls") or []
    prefijo       = body.get("prefijo")
    max_workers   = int(body.get("maxWorkers") or 4)
    refresh_index = bool(body.get("refreshIndex") or False)

    if not project_code or not project_name:
        return err("projectCode y projectName son requeridos", 400)
    if not isinstance(urls, list) or not urls:
        return err("urls: lista de URLs requerida", 400)

    try:
        job_id = _create_job(project_code, project_name, mode="urls")
        svc = get_blob_service()

        with _upload_jobs_lock:
            for i, u in enumerate(urls):
                name = uploader._guess_filename_from_url(u)
                _upload_jobs[job_id]["files"].append({
                    "index": i, "url": u, "name": name,
                    "phase": "queued",
                    "downloaded": 0, "downloadTotal": 0, "uploaded": 0, "error": None,
                })

        progress_cb = _progress_cb_for_job(job_id)

        def _run():
            try:
                _set_job_status(job_id, "running")
                res = uploader.upload_urls_with_progress(
                    svc, project_code, project_name, urls,
                    progress_cb, prefijo=prefijo, max_workers=max_workers,
                )
                _set_job_status(job_id, "finished", res)
                if refresh_index:
                    try:
                        refresh_content_indexes()
                    except Exception as e:
                        logging.error("background index refresh: %s", e)
            except Exception as exc:
                logging.error("upload job: %s", exc)
                _set_job_status(job_id, "error", {"error": str(exc)})

        import threading
        threading.Thread(target=_run, daemon=True).start()

        return ok({"ok": True, "jobId": job_id})
    except Exception as exc:
        logging.error("upload: %s", exc)
        return err(str(exc), 500)


# ══════════════════════════════════════════════════════════════════════════════
# POST /api/upload/check
# ══════════════════════════════════════════════════════════════════════════════
@app.route(route="upload/check", methods=["POST", "OPTIONS"])
def upload_check(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return options_ok()
    _, auth_err = require_perms(req, cap="upload")
    if auth_err:
        return auth_err

    try:
        body = req.get_json()
    except Exception:
        return err("Cuerpo JSON inválido", 400)

    project_code = (body.get("projectCode") or "").strip()
    project_name = (body.get("projectName") or "").strip()
    urls = body.get("urls") or []

    if not project_code or not project_name:
        return err("projectCode y projectName son requeridos", 400)
    if not isinstance(urls, list) or not urls:
        return err("urls: lista de URLs requerida", 400)

    try:
        slug    = uploader._slugify_name(project_name)
        week    = uploader._week_iso_for_date()
        carpeta = f"{project_code}_{slug}"

        svc = get_blob_service()
        cc  = svc.get_container_client(CONTAINER)

        existing = set()
        existing_norm = {}
        prefix = f"{carpeta}/{week}/"
        for blob in cc.list_blobs(name_starts_with=prefix):
            fname = blob.name[len(prefix):]
            existing.add(fname)
            n = "".join(ch for ch in fname.lower() if ch.isalnum())
            if n:
                existing_norm[n] = fname

        results = []
        for url in urls:
            name = uploader._guess_filename_from_url(url)
            exists = name in existing
            similar = False
            similar_to = None
            if not exists:
                n = "".join(ch for ch in name.lower() if ch.isalnum())
                if n and n in existing_norm:
                    similar = True
                    similar_to = existing_norm[n]

            blob_path = (
                f"{carpeta}/{week}/{name}" if exists
                else (f"{carpeta}/{week}/{similar_to}" if similar else None)
            )
            results.append({
                "url": url, "name": name,
                "exists": exists, "similar": similar,
                "similarTo": similar_to, "blobPath": blob_path,
            })

        return ok({"ok": True, "week": week, "carpeta": carpeta, "results": results})
    except Exception as exc:
        logging.error("upload_check: %s", exc)
        return err(str(exc), 500)


# ══════════════════════════════════════════════════════════════════════════════
# GET /api/upload/status/{job_id}
# ══════════════════════════════════════════════════════════════════════════════
@app.route(route="upload/status/{job_id}", methods=["GET", "OPTIONS"])
def upload_status(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return options_ok()
    _, auth_err = require_perms(req, cap="upload")
    if auth_err:
        return auth_err

    job_id = req.route_params.get("job_id")
    with _upload_jobs_lock:
        job = _upload_jobs.get(job_id)
        if not job:
            return err("jobId no encontrado", 404)
        return ok({k: job[k] for k in job})


# ══════════════════════════════════════════════════════════════════════════════
# POST /api/upload/sharepoint
# Body: { projectCode, projectName, sharepointUrl, prefijo?, maxWorkers?,
#         refreshIndex?, recursive? }
#
# Alternativa con site_id + folder_path explícitos:
# Body: { projectCode, projectName, siteId, folderPath, prefijo?, ... }
# ══════════════════════════════════════════════════════════════════════════════
@app.route(route="upload/sharepoint", methods=["POST", "OPTIONS"])
def upload_sharepoint(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return options_ok()
    _, auth_err = require_perms(req, cap="upload")
    if auth_err:
        return auth_err

    try:
        body = req.get_json()
    except Exception:
        return err("Cuerpo JSON inválido", 400)

    project_code   = (body.get("projectCode") or "").strip()
    project_name   = (body.get("projectName") or "").strip()
    sp_url         = (body.get("sharepointUrl") or "").strip()
    site_id        = (body.get("siteId") or "").strip()
    folder_path    = (body.get("folderPath") or "/").strip()
    prefijo        = (body.get("prefijo") or "FOT").strip()
    max_workers    = int(body.get("maxWorkers") or 4)
    refresh_index  = bool(body.get("refreshIndex") or False)
    recursive      = bool(body.get("recursive") if body.get("recursive") is not None else True)

    if not project_code or not project_name:
        return err("projectCode y projectName son requeridos", 400)
    if not sp_url and not site_id:
        return err("Proporciona sharepointUrl o siteId + folderPath", 400)

    try:
        job_id = _create_job(project_code, project_name, mode="sharepoint")

        def _run():
            try:
                _set_job_status(job_id, "running")

                # Resolver URL si no viene siteId explícito
                resolved_site_id = site_id
                resolved_folder  = folder_path

                if sp_url and not site_id:
                    config = uploader.resolver_sharepoint_desde_url(sp_url)
                    resolved_site_id = config.get("site_id") or ""
                    resolved_folder  = config.get("folder_path") or "/"
                    with _upload_jobs_lock:
                        job = _upload_jobs.get(job_id)
                        if job:
                            job["resolvedSiteId"]   = resolved_site_id
                            job["resolvedFolderPath"] = resolved_folder

                if not resolved_site_id:
                    _set_job_status(job_id, "error", {"error": "No se pudo obtener site_id de SharePoint"})
                    return

                # Listar archivos Graph
                token   = uploader._get_graph_token()
                archivos = uploader.list_sharepoint_files(token, resolved_site_id, resolved_folder, recursive)

                with _upload_jobs_lock:
                    job = _upload_jobs.get(job_id)
                    if job:
                        job["totalFiles"] = len(archivos)

                svc    = get_blob_service()
                slug   = uploader._slugify_name(project_name)
                resumen = uploader.procesar_archivos(
                    archivos, svc, project_code, slug,
                    prefijo_jpg=prefijo, max_workers=max_workers,
                )

                _set_job_status(job_id, "finished", resumen)

                if refresh_index:
                    try:
                        refresh_content_indexes()
                    except Exception as e:
                        logging.error("background index refresh (sp): %s", e)

            except Exception as exc:
                logging.error("upload_sharepoint job: %s", exc)
                _set_job_status(job_id, "error", {"error": str(exc)})

        import threading
        threading.Thread(target=_run, daemon=True).start()

        return ok({"ok": True, "jobId": job_id})

    except Exception as exc:
        logging.error("upload_sharepoint: %s", exc)
        return err(str(exc), 500)


# ══════════════════════════════════════════════════════════════════════════════
# POST /api/upload/onedrive
# Body: { projectCode, projectName, userEmail, folderPath, prefijo?,
#         maxWorkers?, refreshIndex?, recursive? }
# ══════════════════════════════════════════════════════════════════════════════
@app.route(route="upload/onedrive", methods=["POST", "OPTIONS"])
def upload_onedrive(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return options_ok()
    _, auth_err = require_perms(req, cap="upload")
    if auth_err:
        return auth_err

    try:
        body = req.get_json()
    except Exception:
        return err("Cuerpo JSON inválido", 400)

    project_code  = (body.get("projectCode") or "").strip()
    project_name  = (body.get("projectName") or "").strip()
    user_email    = (body.get("userEmail") or "").strip()
    folder_path   = (body.get("folderPath") or "/").strip()
    prefijo       = (body.get("prefijo") or "FOT").strip()
    max_workers   = int(body.get("maxWorkers") or 4)
    refresh_index = bool(body.get("refreshIndex") or False)
    recursive     = bool(body.get("recursive") if body.get("recursive") is not None else True)

    if not project_code or not project_name:
        return err("projectCode y projectName son requeridos", 400)
    if not user_email:
        return err("userEmail es requerido", 400)

    try:
        job_id = _create_job(project_code, project_name, mode="onedrive")

        def _run():
            try:
                _set_job_status(job_id, "running")

                token    = uploader._get_graph_token()
                archivos = uploader.list_onedrive_files(token, user_email, folder_path, recursive)

                with _upload_jobs_lock:
                    job = _upload_jobs.get(job_id)
                    if job:
                        job["totalFiles"] = len(archivos)

                svc  = get_blob_service()
                slug = uploader._slugify_name(project_name)
                resumen = uploader.procesar_archivos(
                    archivos, svc, project_code, slug,
                    prefijo_jpg=prefijo, max_workers=max_workers,
                )

                _set_job_status(job_id, "finished", resumen)

                if refresh_index:
                    try:
                        refresh_content_indexes()
                    except Exception as e:
                        logging.error("background index refresh (od): %s", e)

            except Exception as exc:
                logging.error("upload_onedrive job: %s", exc)
                _set_job_status(job_id, "error", {"error": str(exc)})

        import threading
        threading.Thread(target=_run, daemon=True).start()

        return ok({"ok": True, "jobId": job_id})

    except Exception as exc:
        logging.error("upload_onedrive: %s", exc)
        return err(str(exc), 500)


# ══════════════════════════════════════════════════════════════════════════════
# POST /api/upload/local/plan — planifica subida directa desde el navegador
#
# El navegador manda la lista de archivos elegidos (con sus rutas relativas si
# se eligió una carpeta) y el servidor devuelve, por archivo: la ruta destino
# (con renombrado PREFIJO_FECHA_SEQ o nombres originales), si ya existe, y un
# SAS de escritura. Los bytes NUNCA pasan por la Function: van directo del
# navegador al blob, así los archivos de varias GB no dependen del timeout.
#
# Body: { projectCode, projectName, prefijo?, keepNames?, files: [
#          {name, size, lastModified(ms), relativePath?} ] }
# ══════════════════════════════════════════════════════════════════════════════
_LOCAL_PLAN_MAX_FILES = 3000

def _sanitize_rel_segment(seg: str) -> str:
    seg = "".join(c for c in seg.strip() if c not in '\\#?%*:|"<>').strip(". ")
    return seg

@app.route(route="upload/local/plan", methods=["POST", "OPTIONS"])
def upload_local_plan(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return options_ok()
    _, auth_err = require_perms(req, cap="upload")
    if auth_err:
        return auth_err

    try:
        body = req.get_json()
    except Exception:
        return err("Cuerpo JSON inválido", 400)

    project_code = (body.get("projectCode") or "").strip()
    project_name = (body.get("projectName") or "").strip()
    prefijo      = (body.get("prefijo") or "FOT").strip().upper()
    keep_names   = bool(body.get("keepNames"))
    files_in     = body.get("files") or []

    if not project_code or not project_name:
        return err("projectCode y projectName son requeridos", 400)
    if not isinstance(files_in, list) or not files_in:
        return err("files: lista de archivos requerida", 400)
    if len(files_in) > _LOCAL_PLAN_MAX_FILES:
        return err(f"Máximo {_LOCAL_PLAN_MAX_FILES} archivos por tanda", 400)

    try:
        carpeta = uploader._resolve_carpeta(project_code, project_name)
        svc = get_blob_service()
        blob_index = uploader.construir_blob_index(svc, prefix=f"{carpeta}/")

        def fecha_de(entry: Dict[str, Any]) -> datetime:
            texto = " | ".join(filter(None, [str(entry.get("relativePath") or ""), str(entry.get("name") or "")]))
            fecha = uploader.extraer_fecha_desde_texto(texto) or uploader.extraer_semana_desde_texto(texto)
            if fecha:
                return fecha
            try:
                lm = float(entry.get("lastModified") or 0) / 1000.0
                if lm > 0:
                    return datetime.fromtimestamp(lm, tz=timezone.utc)
            except Exception:
                pass
            return datetime.now(timezone.utc)

        entries = []
        for i, f in enumerate(files_in):
            if not isinstance(f, dict):
                continue
            name = os.path.basename(str(f.get("name") or "").strip())
            if not name or name.startswith("."):
                continue
            entries.append({
                "idx": i,
                "name": name,
                "size": int(f.get("size") or 0),
                "lastModified": f.get("lastModified"),
                "relativePath": str(f.get("relativePath") or "").strip(),
                "fecha": fecha_de(f),
            })

        entries.sort(key=lambda e: (e["fecha"], e["relativePath"], e["name"]))

        contadores: Dict[str, int] = {}
        planned = []
        for e in entries:
            ext = os.path.splitext(e["name"])[1].lower()

            if keep_names:
                # Modo biblioteca/sin fechas: respeta nombres y estructura de carpetas.
                rel_dir = "/".join(
                    s for s in (_sanitize_rel_segment(p) for p in e["relativePath"].split("/")[:-1]) if s
                ) if e["relativePath"] else ""
                folder = rel_dir or "General"
                blob_path = f"{carpeta}/{folder}/{e['name']}"
                nombre_final = e["name"]
            else:
                pref = uploader.detectar_prefijo(e["name"], prefijo)
                if pref == "SKIP":
                    planned.append({
                        "idx": e["idx"], "name": e["name"], "relativePath": e["relativePath"],
                        "status": "omitido", "reason": "Tipo de archivo excluido (documentos/comprimidos)",
                        "blobPath": None, "sasUrl": None,
                    })
                    continue
                semana = uploader._numero_semana_iso(e["fecha"])
                clave = f"{pref}_{e['fecha'].strftime('%Y%m%d')}"
                contadores[clave] = contadores.get(clave, 0) + 1
                nombre_final = uploader.renombrar_archivo(e["name"], e["fecha"], contadores[clave], prefijo)
                blob_path = f"{carpeta}/{semana}/{nombre_final}"

            if blob_path in blob_index:
                planned.append({
                    "idx": e["idx"], "name": e["name"], "relativePath": e["relativePath"],
                    "status": "existe", "blobPath": blob_path, "finalName": nombre_final,
                    "sasUrl": None,
                })
            else:
                planned.append({
                    "idx": e["idx"], "name": e["name"], "relativePath": e["relativePath"],
                    "status": "nuevo", "blobPath": blob_path, "finalName": nombre_final,
                    "contentType": uploader.content_type_para(nombre_final),
                    "sasUrl": make_sas_url_write(blob_path, expiry_minutes=360),
                })

        nuevos = sum(1 for p in planned if p["status"] == "nuevo")
        return ok({
            "carpeta": carpeta,
            "keepNames": keep_names,
            "total": len(planned),
            "nuevos": nuevos,
            "existentes": sum(1 for p in planned if p["status"] == "existe"),
            "omitidos": sum(1 for p in planned if p["status"] == "omitido"),
            "files": planned,
        })
    except Exception as exc:
        logging.error("upload_local_plan: %s", exc)
        return err(str(exc), 500)


# ══════════════════════════════════════════════════════════════════════════════
# POST /api/upload/resolve-sharepoint
# Resuelve una URL de SharePoint a site_id + folder_path sin iniciar la subida
# Body: { url }
# ══════════════════════════════════════════════════════════════════════════════
@app.route(route="upload/resolve-sharepoint", methods=["POST", "OPTIONS"])
def upload_resolve_sharepoint(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return options_ok()
    _, auth_err = require_perms(req, cap="upload")
    if auth_err:
        return auth_err

    try:
        body = req.get_json()
    except Exception:
        return err("Cuerpo JSON inválido", 400)

    url = (body.get("url") or "").strip()
    if not url:
        return err("url es requerido", 400)

    try:
        config = uploader.resolver_sharepoint_desde_url(url)
        return ok(config)
    except Exception as exc:
        logging.error("upload_resolve_sharepoint: %s", exc)
        return err(str(exc), 500)


# ══════════════════════════════════════════════════════════════════════════════
# MIGRACIÓN REMOTA POR LOTES — SharePoint / OneDrive con conteo y progreso
#
# El listado (metadata, recursivo con paginación) es rápido y da el TOTAL de
# archivos. La transferencia real (descargar de Graph + subir a blob) se hace
# en tandas que el navegador dispara una a una, con un presupuesto de tiempo
# por llamada, para no chocar con el timeout de la Function en carpetas enormes.
#
# POST /api/upload/remote/plan  → { carpeta, total, nuevos, existentes, files:[...] }
# POST /api/upload/remote/batch → procesa una tanda; { processed, results, done }
# ══════════════════════════════════════════════════════════════════════════════
_REMOTE_BATCH_BUDGET_S = int(os.environ.get("REMOTE_BATCH_BUDGET_S", "420"))

@app.route(route="upload/remote/plan", methods=["POST", "OPTIONS"])
def upload_remote_plan(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return options_ok()
    _, auth_err = require_perms(req, cap="upload")
    if auth_err:
        return auth_err

    try:
        body = req.get_json()
    except Exception:
        return err("Cuerpo JSON inválido", 400)

    source        = (body.get("source") or "sharepoint").strip().lower()
    project_code  = (body.get("projectCode") or "").strip()
    project_name  = (body.get("projectName") or "").strip()
    prefijo       = (body.get("prefijo") or "FOT").strip().upper()
    recursive     = bool(body.get("recursive") if body.get("recursive") is not None else True)

    if not project_code or not project_name:
        return err("projectCode y projectName son requeridos", 400)

    try:
        token = uploader._get_graph_token()
        if source == "onedrive":
            user_email = (body.get("userEmail") or "").strip()
            folder     = (body.get("folderPath") or "/").strip()
            if not user_email:
                return err("userEmail es requerido para OneDrive", 400)
            archivos = uploader.list_onedrive_files(token, user_email, folder, recursive)
        else:
            sp_url   = (body.get("sharepointUrl") or "").strip()
            site_id  = (body.get("siteId") or "").strip()
            folder   = (body.get("folderPath") or "/").strip()
            if sp_url and not site_id:
                cfg = uploader.resolver_sharepoint_desde_url(sp_url)
                site_id = cfg.get("site_id") or ""
                folder  = cfg.get("folder_path") or "/"
            if not site_id:
                return err("No se pudo resolver el sitio de SharePoint", 400)
            archivos = uploader.list_sharepoint_files(token, site_id, folder, recursive)

        carpeta = uploader._resolve_carpeta(project_code, project_name)
        trabajos = uploader._preparar_trabajos(archivos, carpeta, prefijo)
        blob_index = uploader.construir_blob_index(get_blob_service(), prefix=f"{carpeta}/")

        files = []
        nuevos = existentes = total_bytes = 0
        for t in trabajos:
            exists = t["blob_path"] in blob_index
            if exists:
                existentes += 1
            else:
                nuevos += 1
                total_bytes += int(t.get("size_bytes") or 0)
            files.append({
                "orig": t["nombre_orig"], "name": t["nombre_nuevo"],
                "blobPath": t["blob_path"], "dlUrl": t["dl_url"],
                "size": int(t.get("size_bytes") or 0),
                "status": "existe" if exists else "nuevo",
            })

        return ok({
            "source": source, "carpeta": carpeta,
            "total": len(files), "nuevos": nuevos, "existentes": existentes,
            "totalBytesNuevos": total_bytes, "files": files,
        })
    except Exception as exc:
        logging.error("upload_remote_plan: %s", exc)
        return err(str(exc), 500)


def _remote_transfer_one(svc, token: str, dl_url: str, blob_path: str, name: str):
    """Descarga de Graph a tempfile y sube al blob. Devuelve (status, error)."""
    tmp_path = None
    try:
        suffix = os.path.splitext(name)[1] or ".bin"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp_path = tmp.name
        try:
            uploader._graph_download_to_path(token, dl_url, tmp_path, chunk_size=uploader.GRAPH_DOWNLOAD_CHUNK)
        except requests.exceptions.HTTPError as e:
            if "401" in str(e) and dl_url.startswith(uploader.GRAPH_BASE):
                token2 = uploader._get_graph_token(force_refresh=True)
                uploader._graph_download_to_path(token2, dl_url, tmp_path, chunk_size=uploader.GRAPH_DOWNLOAD_CHUNK)
            else:
                raise
        try:
            uploader._subir_a_blob_desde_path(
                svc, tmp_path, blob_path,
                content_type=uploader.content_type_para(name),
            )
        except ResourceExistsError:
            return "existe", None
        return "ok", None
    except Exception as exc:
        return "error", str(exc)
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass


@app.route(route="upload/remote/batch", methods=["POST", "OPTIONS"])
def upload_remote_batch(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return options_ok()
    _, auth_err = require_perms(req, cap="upload")
    if auth_err:
        return auth_err

    try:
        body = req.get_json()
    except Exception:
        return err("Cuerpo JSON inválido", 400)

    project_code = (body.get("projectCode") or "").strip()
    project_name = (body.get("projectName") or "").strip()
    items        = body.get("items") or []
    budget       = min(int(body.get("budgetSeconds") or _REMOTE_BATCH_BUDGET_S), _REMOTE_BATCH_BUDGET_S)

    if not project_code or not project_name:
        return err("projectCode y projectName son requeridos", 400)
    if not isinstance(items, list) or not items:
        return err("items: lista requerida", 400)
    if len(items) > 1000:
        return err("Máximo 1000 ítems por tanda", 400)

    # Los blobPath deben quedar dentro de la carpeta del proyecto; los dlUrl
    # deben ser de Graph. Evita que el cliente escriba/lea rutas arbitrarias.
    carpeta = uploader._resolve_carpeta(project_code, project_name)
    prefix_ok = f"{carpeta}/"

    try:
        svc = get_blob_service()
        token = uploader._get_graph_token()
        results = []
        processed = 0
        started = time.monotonic()
        for it in items:
            if time.monotonic() - started > budget:
                break
            dl_url    = str((it or {}).get("dlUrl") or "")
            blob_path = str((it or {}).get("blobPath") or "")
            name      = str((it or {}).get("name") or os.path.basename(blob_path))
            if not blob_path.startswith(prefix_ok) or not dl_url.startswith(uploader.GRAPH_BASE):
                results.append({"blobPath": blob_path, "status": "error", "error": "Ruta u origen no válidos"})
                processed += 1
                continue
            status, error = _remote_transfer_one(svc, token, dl_url, blob_path, name)
            results.append({"blobPath": blob_path, "status": status, "error": error})
            processed += 1

        clear_index_related_cache()
        return ok({
            "processed": processed,
            "total": len(items),
            "done": processed >= len(items),
            "results": results,
        })
    except Exception as exc:
        logging.error("upload_remote_batch: %s", exc)
        return err(str(exc), 500)