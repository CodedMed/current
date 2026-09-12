"""Local OCR fallback; rendered pages exist only for the duration of extraction."""
from pathlib import Path
import shutil
import tempfile


def tesseract_available() -> bool:
    try:
        import pytesseract
    except ImportError:
        return False
    return shutil.which(pytesseract.pytesseract.tesseract_cmd) is not None


def extract_text(path: Path) -> str:
    if not tesseract_available():
        return ""
    import fitz
    from PIL import Image
    import pytesseract

    texts = []
    with tempfile.TemporaryDirectory(prefix="cfc-ocr-") as workdir:
        with fitz.open(path) as document:
            if len(document) > 50:
                raise ValueError("Document exceeds the 50-page OCR limit")
            for index, page in enumerate(document):
                image_path = Path(workdir) / f"page-{index}.png"
                try:
                    # Bound rendered dimensions even for unusually large PDF page sizes.
                    scale = min(2, 4000 / max(page.rect.width, page.rect.height))
                    page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False).save(image_path)
                    with Image.open(image_path) as image:
                        texts.append(pytesseract.image_to_string(image, timeout=30))
                finally:
                    image_path.unlink(missing_ok=True)
    return "\n".join(texts)
