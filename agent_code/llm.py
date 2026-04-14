"""LLM Client — communicate with DeepSeek-Coder via Ollama REST API."""

from __future__ import annotations

import json
import time
from typing import Generator

import httpx
from rich.console import Console

from agent_code.config import Settings

console = Console()


class LLMError(Exception):
    """Raised when LLM communication fails."""


class LLMClient:
    """Client for Ollama API with streaming and retry support."""

    def __init__(self, settings: Settings | None = None):
        self.settings = settings or Settings.load()
        self.base_url = self.settings.ollama_url
        self.model = self.settings.model
        self.timeout = 120.0
        self.max_retries = 3

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    def generate(
        self,
        prompt: str,
        *,
        system: str = "",
        temperature: float | None = None,
        stream: bool = True,
    ) -> str:
        """Send prompt to Ollama and return the full response text.

        When *stream* is True the response tokens are printed live.
        """
        temp = temperature if temperature is not None else self.settings.temperature
        payload = {
            "model": self.model,
            "prompt": prompt,
            "stream": stream,
            "options": {
                "temperature": temp,
            },
        }
        if system:
            payload["system"] = system

        for attempt in range(1, self.max_retries + 1):
            try:
                if stream:
                    return self._stream_generate(payload)
                else:
                    return self._batch_generate(payload)
            except (httpx.ConnectError, httpx.TimeoutException) as exc:
                if attempt == self.max_retries:
                    raise LLMError(
                        f"Cannot connect to Ollama at {self.base_url} "
                        f"after {self.max_retries} attempts. "
                        f"Make sure Ollama is running (`ollama serve`)."
                    ) from exc
                wait = 2 ** attempt
                console.print(
                    f"[yellow]⚠ Connection failed (attempt {attempt}/{self.max_retries}), "
                    f"retrying in {wait}s…[/yellow]"
                )
                time.sleep(wait)

        # Should never reach here, but satisfy type checker
        raise LLMError("Unexpected error in generate loop")

    def check_connection(self) -> bool:
        """Return True if Ollama is reachable."""
        try:
            resp = httpx.get(f"{self.base_url}/api/tags", timeout=5.0)
            return resp.status_code == 200
        except (httpx.ConnectError, httpx.TimeoutException):
            return False

    def list_models(self) -> list[str]:
        """Return list of locally available model names."""
        try:
            resp = httpx.get(f"{self.base_url}/api/tags", timeout=5.0)
            resp.raise_for_status()
            data = resp.json()
            return [m["name"] for m in data.get("models", [])]
        except Exception:
            return []

    # ------------------------------------------------------------------
    # Private
    # ------------------------------------------------------------------

    def _stream_generate(self, payload: dict) -> str:
        """Stream tokens from Ollama and return the full text."""
        url = f"{self.base_url}/api/generate"
        collected: list[str] = []

        with httpx.stream(
            "POST",
            url,
            json=payload,
            timeout=httpx.Timeout(self.timeout, connect=10.0),
        ) as response:
            response.raise_for_status()
            for line in response.iter_lines():
                if not line:
                    continue
                try:
                    chunk = json.loads(line)
                except json.JSONDecodeError:
                    continue
                token = chunk.get("response", "")
                if token:
                    collected.append(token)
                    console.print(token, end="", highlight=False)
                if chunk.get("done", False):
                    break

        console.print()  # newline after stream
        return "".join(collected)

    def _batch_generate(self, payload: dict) -> str:
        """Non-streaming generation."""
        url = f"{self.base_url}/api/generate"
        payload["stream"] = False
        resp = httpx.post(
            url,
            json=payload,
            timeout=httpx.Timeout(self.timeout, connect=10.0),
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("response", "")
