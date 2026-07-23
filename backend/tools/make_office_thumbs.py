"""
Genera las miniaturas de los archivos que el backend no sabe rasterizar
(Word, PowerPoint, Excel, .ai, .psd…) y las sube a la convención que consume
/api/thumb:

    _media/documentos/Plantillas/informe.docx
    → _thumbs/_media/documentos/Plantillas/informe.docx.jpg

Por qué aquí y no en la Function: Azure Functions en plan Consumption no trae
LibreOffice ni Office, así que no puede convertir un .docx a imagen. Este script
se ejecuta en un equipo que sí los tenga (el mismo desde el que se sube el
material) y deja las miniaturas listas en el blob. Sin miniatura, la app no se
rompe: cae al monograma de tipo de archivo.

Uso:
    python make_office_thumbs.py                      # toda la biblioteca
    python make_office_thumbs.py --section documentos # solo una sección
    python make_office_thumbs.py --force              # regenera las existentes

Requisitos:
    pip install azure-storage-blob pillow pymupdf
    LibreOffice en el PATH (soffice / soffice.exe). En Windows suele estar en
    C:\\Program Files\\LibreOffice\\program\\soffice.exe — pásalo con --soffice.

Variables de entorno (las mismas que el backend):
    AZURE_STORAGE_CONNECTION_STRING, BLOB_CONTAINER
"""
import argparse
import io
import os
import shutil
import subprocess
import sys
import tempfile

from azure.storage.blob import BlobServiceClient
from azure.core.exceptions import ResourceNotFoundError
from PIL import Image

CONTAINER = os.environ.get("BLOB_CONTAINER", "audiovisual")
MEDIA_PREFIX = os.environ.get("MEDIA_PREFIX", "_media")
THUMBS_PREFIX = os.environ.get("THUMBS_PREFIX", "_thumbs")

# Lo que sabe convertir LibreOffice y para lo que el frontend pide miniatura.
CONVERTIBLE = (".doc", ".docx", ".rtf", ".xls", ".xlsx", ".ppt", ".pptx")
THUMB_WIDTH = 640
JPEG_QUALITY = 82


def sidecar_name(blob_name: str) -> str:
    return f"{THUMBS_PREFIX.strip('/')}/{blob_name.strip('/')}.jpg"


def find_soffice(explicit: str = None) -> str:
    if explicit:
        if not os.path.isfile(explicit):
            sys.exit(f"No existe: {explicit}")
        return explicit
    found = shutil.which("soffice") or shutil.which("soffice.exe")
    if found:
        return found
    for guess in (
        r"C:\Program Files\LibreOffice\program\soffice.exe",
        r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
        "/usr/bin/soffice",
        "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    ):
        if os.path.isfile(guess):
            return guess
    sys.exit("No se encontró LibreOffice. Instálalo o pásalo con --soffice.")


def first_page_jpeg(raw: bytes, suffix: str, soffice: str) -> bytes:
    """documento → PDF (LibreOffice) → JPEG de la primera página (PyMuPDF)."""
    import fitz  # pymupdf

    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, f"doc{suffix}")
        with open(src, "wb") as fh:
            fh.write(raw)
        # --headless no abre ventana; el perfil aislado evita chocar con una
        # instancia de LibreOffice ya abierta en el equipo.
        subprocess.run(
            [soffice, "--headless", "--norestore",
             f"-env:UserInstallation=file:///{tmp.replace(os.sep, '/')}/profile",
             "--convert-to", "pdf", "--outdir", tmp, src],
            check=True, timeout=180,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        pdf = os.path.join(tmp, "doc.pdf")
        if not os.path.isfile(pdf):
            raise RuntimeError("LibreOffice no produjo PDF")

        doc = fitz.open(pdf)
        try:
            page = doc.load_page(0)
            zoom = THUMB_WIDTH / page.rect.width
            pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom))
            img = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
        finally:
            doc.close()

    out = io.BytesIO()
    img.save(out, format="JPEG", quality=JPEG_QUALITY, optimize=True, progressive=True)
    return out.getvalue()


def main() -> int:
    ap = argparse.ArgumentParser(description="Genera miniaturas de Office en _thumbs/")
    ap.add_argument("--section", help="Solo esta sección (marcas, documentos…)")
    ap.add_argument("--force", action="store_true", help="Regenera las que ya existen")
    ap.add_argument("--soffice", help="Ruta a soffice/soffice.exe")
    ap.add_argument("--dry-run", action="store_true", help="Lista sin subir nada")
    args = ap.parse_args()

    conn = os.environ.get("AZURE_STORAGE_CONNECTION_STRING", "")
    if not conn:
        sys.exit("Falta AZURE_STORAGE_CONNECTION_STRING en el entorno.")
    soffice = find_soffice(args.soffice) if not args.dry_run else ""

    cc = BlobServiceClient.from_connection_string(conn).get_container_client(CONTAINER)
    prefix = f"{MEDIA_PREFIX.strip('/')}/"
    if args.section:
        prefix += f"{args.section}/"

    done = skipped = failed = 0
    for blob in cc.list_blobs(name_starts_with=prefix):
        if not blob.name.lower().endswith(CONVERTIBLE):
            continue
        target = sidecar_name(blob.name)
        if not args.force:
            try:
                if cc.get_blob_client(target).exists():
                    skipped += 1
                    continue
            except Exception:
                pass

        if args.dry_run:
            print(f"[pendiente] {blob.name}")
            done += 1
            continue

        try:
            raw = cc.download_blob(blob.name).readall()
            suffix = os.path.splitext(blob.name)[1].lower()
            jpeg = first_page_jpeg(raw, suffix, soffice)
            cc.upload_blob(name=target, data=jpeg, overwrite=True,
                           content_type="image/jpeg")
            print(f"[ok] {blob.name}")
            done += 1
        except Exception as exc:
            print(f"[error] {blob.name}: {exc}")
            failed += 1

    print(f"\nMiniaturas: {done} generadas, {skipped} ya existían, {failed} con error.")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
