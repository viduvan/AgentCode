"""Configuration management for Agent Code CLI."""

import json
from pathlib import Path
from pydantic import BaseModel, Field


class Settings(BaseModel):
    """Application settings with sensible defaults."""

    ollama_url: str = Field(
        default="http://localhost:11434",
        description="Ollama server URL",
    )
    model: str = Field(
        default="deepseek-coder-v2:16b",
        description="LLM model name for Ollama",
    )
    max_context_tokens: int = Field(
        default=4000,
        description="Maximum tokens to include in context",
    )
    max_scan_depth: int = Field(
        default=5,
        description="Maximum directory depth for project scanning",
    )
    temperature: float = Field(
        default=0.1,
        description="LLM temperature (lower = more deterministic)",
    )

    @classmethod
    def config_dir(cls) -> Path:
        """Get the config directory path."""
        path = Path.home() / ".agent-code"
        path.mkdir(parents=True, exist_ok=True)
        return path

    @classmethod
    def config_file(cls) -> Path:
        """Get the config file path."""
        return cls.config_dir() / "config.json"

    @classmethod
    def load(cls) -> "Settings":
        """Load settings from config file, or return defaults."""
        config_file = cls.config_file()
        if config_file.exists():
            try:
                data = json.loads(config_file.read_text(encoding="utf-8"))
                return cls(**data)
            except (json.JSONDecodeError, ValueError):
                return cls()
        return cls()

    def save(self) -> None:
        """Save current settings to config file."""
        config_file = self.config_file()
        config_file.write_text(
            self.model_dump_json(indent=2),
            encoding="utf-8",
        )
