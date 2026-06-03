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
from urllib.parse import unquote
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

def build_thumbnail_bytes(raw_bytes: bytes, max_width: int = 480, quality: int = 72) -> bytes:
    with Image.open(io.BytesIO(raw_bytes)) as img:
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
    if not is_authenticated(req):
        return err("No autorizado", 401)

    blob_path = (req.params.get("blobPath") or "").strip()
    ext = ext_of(blob_path)
    if not blob_path:
        return err("blobPath es requerido")
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
# GET/POST /api/projects/{project_id}/settings
# ══════════════════════════════════════════════════════════════════════════════
@app.route(route="projects/{project_id}/settings", methods=["GET", "POST", "OPTIONS"])
def project_settings(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return options_ok()
    if not is_authenticated(req):
        return err("No autorizado", 401)

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
    if not is_authenticated(req):
        return err("No autorizado", 401)

    project_id = req.route_params.get("project_id", "")
    week       = normalize_folder_path(req.route_params.get("week", ""))
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
    if not is_authenticated(req):
        return err("No autorizado", 401)

    project_id = req.route_params.get("project_id", "")
    path = normalize_folder_path(req.params.get("path", ""))
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
        if not is_authenticated(req):
            return err("No autorizado", 401)
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
    if not is_authenticated(req):
        return err("No autorizado", 401)

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
    if not is_authenticated(req):
        return err("No autorizado", 401)

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
    if not is_authenticated(req):
        return err("No autorizado", 401)

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
    if not is_authenticated(req):
        return err("No autorizado", 401)

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
    if not is_authenticated(req):
        return err("No autorizado", 401)

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
# POST /api/upload/resolve-sharepoint
# Resuelve una URL de SharePoint a site_id + folder_path sin iniciar la subida
# Body: { url }
# ══════════════════════════════════════════════════════════════════════════════
@app.route(route="upload/resolve-sharepoint", methods=["POST", "OPTIONS"])
def upload_resolve_sharepoint(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return options_ok()
    if not is_authenticated(req):
        return err("No autorizado", 401)

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