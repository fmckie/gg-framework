# gg-pixel (Python)

Universal error tracking pixel — Python SDK. Same wire format as the
JS/Node and browser SDKs; same backend.

## Install

```bash
pip install gg-pixel
```

## Use

```python
from gg_pixel import init_pixel, capture_exception, report

init_pixel(project_key="pk_live_...")

# Anything uncaught after this point is automatically reported.

try:
    risky()
except Exception as e:
    capture_exception(e)

report("user clicked the broken button")
```

Hooks installed by default: `sys.excepthook`, `threading.excepthook`,
`asyncio.set_exception_handler`. Optional: `capture_logging_errors=True`
to capture `logging.error()` calls.
