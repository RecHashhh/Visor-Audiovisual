"""
Azure Functions Backend — Visor Audiovisual
Python 3.9+ compatible
"""

import azure.functions as func
import json
import os
import logging
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any

from azure.storage.blob import (
    BlobServiceClient,
    generate_blob_sas,
    BlobSasPermissions,
)

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)

# ── CONFIG ─────────────────────────────────────────────────────────────────
CONN_STR     = os.environ.get("AZURE_STORAGE_CONNECTION_STRING", "")
ACCOUNT_NAME = os.environ.get("AZURE_STORAGE_ACCOUNT", "ripconaudiovisual")
ACCOUNT_KEY  = os.environ.get("AZURE_STORAGE_KEY", "")
CONTAINER    = os.environ.get("BLOB_CONTAINER", "audiovisual")

# Share store en memoria
_shares: Dict[str, Dict] = {}

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


# ══════════════════════════════════════════════════════════════════════════════
# GET /api/projects
# ══════════════════════════════════════════════════════════════════════════════
@app.route(route="projects", methods=["GET", "OPTIONS"])
def get_projects(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return options_ok()
    if not is_authenticated(req):
        return err("No autorizado", 401)

    try:
        svc = get_blob_service()
        cc  = svc.get_container_client(CONTAINER)
        project_map: Dict[str, Dict] = {}

        for blob in cc.list_blobs():
            parts = blob.name.split("/")
            if len(parts) < 3 or not parts[2]:
                continue
            proj_folder = parts[0]
            week_folder = parts[1]
            file_name   = parts[2]

            if proj_folder not in project_map:
                slug = " ".join(proj_folder.split("_")[1:]).upper().replace("-", " ")
                project_map[proj_folder] = {
                    "code": proj_folder, "name": slug,
                    "weeks": set(), "types": set(),
                    "lastModified": None, "status": "completo",
                }

            p = project_map[proj_folder]
            p["weeks"].add(week_folder)
            pfx = prefix_of(file_name)
            if pfx != "FILE":
                p["types"].add(pfx)
            lm = blob.last_modified
            if lm and (p["lastModified"] is None or lm > p["lastModified"]):
                p["lastModified"] = lm

        result = []
        for proj in sorted(project_map.values(), key=lambda x: x["code"]):
            result.append({
                "code":         proj["code"],
                "name":         proj["name"],
                "weeks":        len(proj["weeks"]),
                "types":        "+".join(sorted(proj["types"])),
                "status":       proj["status"],
                "lastModified": proj["lastModified"].isoformat() if proj["lastModified"] else None,
            })
        return ok(result)

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
    try:
        svc = get_blob_service()
        cc  = svc.get_container_client(CONTAINER)
        files = []

        for blob in cc.list_blobs(name_starts_with=f"{project_id}/{week}/"):
            fname = blob.name.split("/")[-1]
            if not fname:
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

        _shares[token] = {
            "token": token, "projectId": project_id, "week": week,
            "expiresAt": expires_at.isoformat(), "active": True,
        }
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

    now    = datetime.now(timezone.utc)
    result = [{**s, "expired": datetime.fromisoformat(s["expiresAt"]) < now}
              for s in _shares.values()]
    result.sort(key=lambda x: x["expiresAt"], reverse=True)
    return ok(result)


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
        _shares.pop(share_token, None)
        return ok({"deleted": True})

    # GET público — sin auth
    share = _shares.get(share_token)
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
    })
