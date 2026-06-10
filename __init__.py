"""
ComfyFlow — browse and load workflows from comfy-flow.com inside ComfyUI.
 
"""

from __future__ import annotations

import os
import sys

# ComfyUI loads this file without putting the plugin folder on sys.path.
_PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))
if _PLUGIN_DIR not in sys.path:
    sys.path.insert(0, _PLUGIN_DIR)

WEB_DIRECTORY = "./js"

NODE_CLASS_MAPPINGS: dict = {}
NODE_DISPLAY_NAME_MAPPINGS: dict = {}


def _detect_comfyui_port() -> int:
    for key in ("COMFYUI_PORT", "PORT"):
        val = os.environ.get(key)
        if val and val.isdigit():
            return int(val)
    try:
        import sys

        for i, arg in enumerate(sys.argv):
            if arg in ("--port", "-p") and i + 1 < len(sys.argv):
                return int(sys.argv[i + 1])
    except (ValueError, IndexError):
        pass
    return 8188


def _register() -> None:
    try:
        from server import PromptServer

        from comfyflow_middleware import install_cors_middleware
        from comfyflow_routes import register_routes

        install_cors_middleware()
        port = _detect_comfyui_port()
        register_routes(PromptServer.instance.routes, port)
        print(
            f"[ComfyFlow] Plugin ready on port {port} — "
            "click the purple ComfyFlow button (bottom-right) or menu: Extensions → ComfyFlow"
        )
    except Exception as exc:
        print(f"[ComfyFlow] Failed to register routes: {exc}")


_register()
