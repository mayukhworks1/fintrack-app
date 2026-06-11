"""
Hugging Face Dataset-backed file storage (Mayukhjh24/fintrackstorage).

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
MAX_AVATAR_BYTES = 4 * 1024 * 1024  # 4 MB

EXT_FOR_MIME = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
}
MIME_FOR_EXT = {v: k for k, v in EXT_FOR_MIME.items()}
MIME_FOR_EXT["jpeg"] = "image/jpeg"


def _hf_api():
    from huggingface_hub import HfApi
    return HfApi(token=settings.hf_token)


def _repo_id() -> str:
    return settings.hf_dataset_repo or "Mayukhjh24/fintrackstorage"


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
