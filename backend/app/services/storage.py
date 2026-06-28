"""
Hugging Face Dataset-backed file storage (Mayukhj24/fintrackstorage).

Files are stored in a private HF dataset and proxied through the backend
API so authentication is always required to read them.
"""
from __future__ import annotations

import asyncio
import io
import logging
from typing import Optional

from ..config import settings

logger = logging.getLogger("fintrack.storage")

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}

_repo_ensured: bool = False


def _ensure_repo_sync() -> None:
    """Create the HF dataset repo if it doesn't exist yet (idempotent)."""
    global _repo_ensured
    if _repo_ensured:
        return
    api = _hf_api()
    repo = _repo_id()
    try:
        api.repo_info(repo_id=repo, repo_type="dataset")
        logger.info("storage: HF dataset repo %s exists", repo)
    except Exception:
        try:
            api.create_repo(repo_id=repo, repo_type="dataset", private=True)
            logger.info("storage: created private HF dataset repo %s", repo)
        except Exception as create_exc:
            logger.warning("storage: could not create repo %s: %s", repo, create_exc)
    _repo_ensured = True
MAX_AVATAR_BYTES = 4 * 1024 * 1024  # 4 MB

MAX_PAGE_FILE_BYTES = 25 * 1024 * 1024  # 25 MB per page attachment

EXT_FOR_MIME = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "application/pdf": "pdf",
    "text/plain": "txt",
    "text/csv": "csv",
    "text/markdown": "md",
    "application/json": "json",
    "application/zip": "zip",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.ms-powerpoint": "ppt",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    "video/mp4": "mp4",
    "audio/mpeg": "mp3",
}
MIME_FOR_EXT = {v: k for k, v in EXT_FOR_MIME.items()}
MIME_FOR_EXT["jpeg"] = "image/jpeg"

# File types that are safe to render inline in the browser (others download).
INLINE_MIME = {
    "image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml",
    "application/pdf", "text/plain", "text/csv", "text/markdown",
    "video/mp4", "audio/mpeg",
}


def _hf_api():
    from huggingface_hub import HfApi
    return HfApi(token=settings.hf_token)


def _repo_id() -> str:
    return settings.hf_dataset_repo or "Mayukhj24/fintrackstorage"


def _proxy_url(path_in_repo: str) -> str:
    return f"/api/storage/file/{path_in_repo}"


async def upload_bytes(
    data: bytes,
    path_in_repo: str,
    content_type: str = "application/octet-stream",
) -> str:
    """Upload bytes to the HF dataset. Returns the backend proxy URL."""
    api = _hf_api()
    repo = _repo_id()

    def _sync():
        _ensure_repo_sync()
        api.upload_file(
            path_or_fileobj=io.BytesIO(data),
            path_in_repo=path_in_repo,
            repo_id=repo,
            repo_type="dataset",
            commit_message=f"Upload {path_in_repo}",
        )

    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _sync)
    logger.info("storage: uploaded %d bytes → %s/%s", len(data), repo, path_in_repo)
    return _proxy_url(path_in_repo)


async def read_bytes(path_in_repo: str) -> Optional[bytes]:
    """Download a file from the HF dataset; returns None if not found."""
    from huggingface_hub import hf_hub_download
    from huggingface_hub.utils import EntryNotFoundError

    def _sync() -> Optional[bytes]:
        try:
            local = hf_hub_download(
                repo_id=_repo_id(),
                filename=path_in_repo,
                repo_type="dataset",
                token=settings.hf_token,
            )
            with open(local, "rb") as f:
                return f.read()
        except EntryNotFoundError:
            return None
        except Exception as exc:
            logger.warning("storage: read failed for %s: %s", path_in_repo, exc)
            return None

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _sync)


async def delete_path(path_in_repo: str) -> None:
    """Remove a file from the HF dataset (best-effort, never raises)."""
    api = _hf_api()
    repo = _repo_id()

    def _sync():
        api.delete_file(
            path_in_repo=path_in_repo,
            repo_id=repo,
            repo_type="dataset",
            commit_message=f"Delete {path_in_repo}",
        )

    loop = asyncio.get_event_loop()
    try:
        await loop.run_in_executor(None, _sync)
        logger.info("storage: deleted %s/%s", repo, path_in_repo)
    except Exception as exc:
        logger.warning("storage: delete failed for %s: %s", path_in_repo, exc)
