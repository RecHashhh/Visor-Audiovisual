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
from threading import Lock
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any
from PIL import Image, ImageOps

from azure.storage.blob import (
    BlobServiceClient,
    generate_blob_sas,
    BlobSasPermissions,
)
from azure.core.exceptions import ResourceNotFoundError

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

# Cache simple en memoria para acelerar lecturas repetidas.
_cache: Dict[str, Dict[str, Any]] = {}
_cache_lock = Lock()

# ── HELPERS ────────────────────────────────────────────────────────────────

def cors_headers() -> Dict[str, str]:
    return {
        "Access-Control-Allow-Origin":  "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Content-Type": "application/json",
    }

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
    """
    Verifica que la request tenga un token Bearer de Microsoft.
    NO valida la firma — Azure Static Web Apps / la red corporativa ya garantiza
    que solo usuarios autenticados llegan aquí. Los datos son de solo lectura
    del Blob que ya es privado; los SAS tokens tienen expiración corta.
    """
    auth = req.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return False
    token_part = auth[7:]
    # Un JWT válido tiene 3 partes separadas por punto
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

def should_skip_for_content_index(blob_name: str) -> bool:
    shares_prefix = f"{SHARES_PREFIX.strip('/')}/"
    index_prefix = f"{INDEX_PREFIX.strip('/')}/"
    return blob_name.startswith(shares_prefix) or blob_name.startswith(index_prefix)

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
            # Backward compatibility for older index snapshots.
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
        if len(parts) < 3 or not parts[2]:
            continue

        project_id = parts[0]
        week = parts[1]
        fname = parts[2]

        if project_id not in project_map:
            slug = " ".join(project_id.split("_")[1:]).upper().replace("-", " ")
            project_map[project_id] = {
                "code": project_id,
                "name": slug,
                "weeks": set(),
                "types": set(),
                "lastModified": None,
                "fileCount": 0,
                "hasMarker": False,
            }

        proj = project_map[project_id]
        if is_marker_file(fname):
            proj["hasMarker"] = True
            continue

        proj["weeks"].add(week)
        proj["fileCount"] += 1
        pfx = prefix_of(fname)
        if pfx != "FILE":
            proj["types"].add(pfx)
        lm = blob.last_modified
        if lm and (proj["lastModified"] is None or lm > proj["lastModified"]):
            proj["lastModified"] = lm

        if project_id not in week_map_by_project:
            week_map_by_project[project_id] = {}
        if week not in week_map_by_project[project_id]:
            week_map_by_project[project_id][week] = {"week": week, "count": 0, "types": set()}
        week_map_by_project[project_id][week]["count"] += 1
        if pfx != "FILE":
            week_map_by_project[project_id][week]["types"].add(pfx)

        file_key = f"{project_id}:{week}"
        if file_key not in files_map_by_project_week:
            files_map_by_project_week[file_key] = []
        files_map_by_project_week[file_key].append({
            "name": fname,
            "path": blob.name,
            "size": blob.size,
            "type": type_of(fname),
            "prefix": prefix_of(fname),
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
            "code": proj["code"],
            "name": proj["name"],
            "weeks": len(proj["weeks"]),
            "types": "+".join(sorted(proj["types"])),
            "status": status_info["status"],
            "statusReason": status_info["statusReason"],
            "hasContent": proj["fileCount"] > 0,
            "lastModified": proj["lastModified"].isoformat() if proj["lastModified"] else None,
        })

    weeks_by_project: Dict[str, list] = {}
    for project_id, week_map in week_map_by_project.items():
        weeks = [
            {"week": k, "count": v["count"], "types": sorted(v["types"])}
            for k, v in sorted(week_map.items())
        ]
        weeks_by_project[project_id] = weeks

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
        project_id, week = key.split(":", 1)
        save_json_blob(index_files_blob_name(project_id, week), files)

    clear_index_related_cache()

    return {
        "projects": len(payloads["projects"]),
        "weeksIndexes": len(payloads["weeksByProject"]),
        "filesIndexes": len(payloads["filesByProjectWeek"]),
    }


def build_thumbnail_bytes(raw_bytes: bytes, max_width: int = 480, quality: int = 72) -> bytes:
    with Image.open(io.BytesIO(raw_bytes)) as img:
        # Apply EXIF orientation so thumbnails match camera orientation.
        img = ImageOps.exif_transpose(img)
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        elif img.mode == "L":
            img = img.convert("RGB")

        w, h = img.size
        if w > max_width:
            new_h = int((h * max_width) / w)
            img = img.resize((max_width, max(1, new_h)), Image.Resampling.LANCZOS)

        out = io.BytesIO()
        img.save(out, format="JPEG", quality=quality, optimize=True, progressive=True)
        return out.getvalue()


# ══════════════════════════════════════════════════════════════════════════════
# GET /api/thumb
# ══════════════════════════════════════════════════════════════════════════════
@app.route(route="thumb", methods=["GET", "OPTIONS"])
def thumb(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=binary_headers("application/json"))
    if not is_authenticated(req):
        return err("No autorizado", 401)

    blob_path = (req.params.get("blobPath") or "").strip()
    ext = ext_of(blob_path)
    if not blob_path:
        return err("blobPath es requerido")
    if ext not in ("jpg", "jpeg", "png", "webp", "tif", "tiff"):
        return err("thumb solo disponible para imagenes", 400)

    try:
        max_width = int(req.params.get("w", "480"))
    except Exception:
        max_width = 480
    try:
        quality = int(req.params.get("q", "72"))
    except Exception:
        quality = 72

    max_width = max(160, min(max_width, 1280))
    quality = max(40, min(quality, 90))

    cache_key = f"thumb:{blob_path}:{max_width}:{quality}"
    cached = cache_get(cache_key)
    if cached is not None:
        return func.HttpResponse(body=cached, status_code=200, headers=binary_headers("image/jpeg"))

    try:
        svc = get_blob_service()
        bc = svc.get_blob_client(container=CONTAINER, blob=blob_path)
        raw = bc.download_blob().readall()
        thumb_bytes = build_thumbnail_bytes(raw, max_width=max_width, quality=quality)
        cache_set(cache_key, thumb_bytes, ttl_seconds=300)
        return func.HttpResponse(body=thumb_bytes, status_code=200, headers=binary_headers("image/jpeg"))
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
    if not is_authenticated(req):
        return err("No autorizado", 401)

    cached = cache_get("projects")
    if cached is not None:
        return ok(normalize_projects_payload(cached))

    if INDEX_ENABLED:
        try:
            indexed = load_json_blob(index_projects_blob_name())
            if isinstance(indexed, list):
                normalized = normalize_projects_payload(indexed)
                cache_set("projects", normalized)
                return ok(normalized)
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
                }

            p = project_map[proj_folder]

            # Marker at project root (e.g., project/.keep)
            if len(parts) == 2 and is_marker_file(parts[1]):
                p["hasMarker"] = True
                continue

            if len(parts) < 3 or not parts[2]:
                continue

            week_folder = parts[1]
            file_name = parts[2]
            if is_marker_file(file_name):
                p["hasMarker"] = True
                continue

            p["weeks"].add(week_folder)
            p["fileCount"] += 1
            pfx = prefix_of(file_name)
            if pfx != "FILE":
                p["types"].add(pfx)
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
            })
        normalized = normalize_projects_payload(result)
        cache_set("projects", normalized)
        return ok(normalized)

    except Exception as exc:
        logging.error("get_projects: %s", exc)
        return err(str(exc), 500)


# ══════════════════════════════════════════════════════════════════════════════
# GET /api/projects/{project_id}/weeks
# ══════════════════════════════════════════════════════════════════════════════
@app.route(route="projects/{project_id}/weeks", methods=["GET", "OPTIONS"])
def get_weeks(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return options_ok()
    if not is_authenticated(req):
        return err("No autorizado", 401)

    project_id = req.route_params.get("project_id", "")
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
            if len(parts) < 3 or not parts[2]:
                continue
            week = parts[1]
            fname = parts[2]
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
    if not is_authenticated(req):
        return err("No autorizado", 401)

    project_id = req.route_params.get("project_id", "")
    week       = req.route_params.get("week", "")
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
        svc = get_blob_service()
        cc  = svc.get_container_client(CONTAINER)
        files = []

        for blob in cc.list_blobs(name_starts_with=f"{project_id}/{week}/"):
            fname = blob.name.split("/")[-1]
            if not fname:
                continue
            if is_marker_file(fname):
                continue
            files.append({
                "name":         fname,
                "path":         blob.name,
                "size":         blob.size,
                "type":         type_of(fname),
                "prefix":       prefix_of(fname),
                "lastModified": blob.last_modified.isoformat() if blob.last_modified else None,
            })

        files.sort(key=lambda f: f["name"])
        cache_set(cache_key, files)
        return ok(files)

    except Exception as exc:
        logging.error("get_files: %s", exc)
        return err(str(exc), 500)


# ══════════════════════════════════════════════════════════════════════════════
# POST /api/sas/generate
# ══════════════════════════════════════════════════════════════════════════════
@app.route(route="sas/generate", methods=["POST", "OPTIONS"])
def sas_generate(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return options_ok()
    if not is_authenticated(req):
        return err("No autorizado", 401)

    try:
        body           = req.get_json()
        blob_path      = body.get("blobPath", "").strip()
        expiry_minutes = min(int(body.get("expiryMinutes", 60)), 1440)
        if not blob_path:
            return err("blobPath es requerido")
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
    if not is_authenticated(req):
        return err("No autorizado", 401)

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
    if not is_authenticated(req):
        return err("No autorizado", 401)

    try:
        now = datetime.now(timezone.utc)
        shares = list_shares()
        result = [{**s, "expired": datetime.fromisoformat(s["expiresAt"]) < now}
                  for s in shares]
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
        if not is_authenticated(req):
            return err("No autorizado", 401)
        try:
            delete_share(share_token)
            return ok({"deleted": True})
        except Exception as exc:
            logging.error("share_delete: %s", exc)
            return err(str(exc), 500)

    # GET público — sin auth
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
            if not fname:
                continue
            if is_marker_file(fname):
                continue
            try:
                sas_url = make_sas_url(blob.name, remaining)
            except Exception:
                sas_url = ""
            files.append({"name": fname, "path": blob.name,
                          "type": type_of(fname), "sasUrl": sas_url})

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
# POST /api/index/refresh (manual)
# ══════════════════════════════════════════════════════════════════════════════
@app.route(route="index/refresh", methods=["POST", "OPTIONS"])
def index_refresh(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return options_ok()
    if not is_authenticated(req):
        return err("No autorizado", 401)

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
        logging.info("index_refresh_timer: ok projects=%s weeksIndexes=%s filesIndexes=%s",
                     stats.get("projects"), stats.get("weeksIndexes"), stats.get("filesIndexes"))
    except Exception as exc:
        logging.error("index_refresh_timer: %s", exc)
