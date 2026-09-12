from __future__ import annotations

from fastapi import APIRouter, Depends, File, UploadFile

from app.config import Settings, get_settings
from app.documents.schemas import ExtractionResponse
from app.documents.service import DocumentService
from app.security import require_internal_caller

router = APIRouter(prefix="/v1/documents", tags=["documents"])


def _service(settings: Settings = Depends(get_settings)) -> DocumentService:
    return DocumentService(settings)


@router.post(
    "/extract",
    response_model=ExtractionResponse,
    response_model_by_alias=True,
    dependencies=[Depends(require_internal_caller)],
)
async def extract(
    file: UploadFile = File(...),
    service: DocumentService = Depends(_service),
) -> ExtractionResponse:
    """Processed locally: the file is parsed in a temp directory and deleted before responding."""
    try:
        content = await file.read(service._settings.max_upload_bytes + 1)
        return await service.extract(file.filename or "document", file.content_type, content)
    finally:
        await file.close()
