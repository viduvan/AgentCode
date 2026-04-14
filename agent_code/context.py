"""Context Builder — assemble code context for LLM consumption."""

from __future__ import annotations

from pathlib import Path

from agent_code.config import Settings
from agent_code.scanner import FileInfo


class ContextBuilder:
    """Build optimized context string from relevant files.

    Reads file contents, trims to token budget, and formats
    them in a way the LLM can understand.
    """

    # Rough approximation: 1 token ≈ 4 chars for code
    CHARS_PER_TOKEN = 4

    def __init__(self, settings: Settings | None = None):
        self.settings = settings or Settings.load()
        self.max_chars = self.settings.max_context_tokens * self.CHARS_PER_TOKEN

    def build_context(
        self,
        files: list[FileInfo],
        instruction: str,
        *,
        project_root: Path | None = None,
    ) -> str:
        """Build a formatted context string from the given files.

        Files are included in order (first file = highest priority).
        Content is truncated if the total exceeds the token budget.
        """
        if not files:
            return "(No relevant source files found)"

        parts: list[str] = []
        chars_used = 0

        for fi in files:
            content = self._read_file(fi.path)
            if content is None:
                continue

            # Build file block
            rel = fi.relative_path
            if project_root:
                try:
                    rel = str(fi.path.relative_to(project_root))
                except ValueError:
                    pass

            header = f"=== File: {rel} ==="
            block = f"{header}\n{content}\n"

            block_chars = len(block)
            if chars_used + block_chars > self.max_chars:
                # Truncate this file's content to fit
                remaining = self.max_chars - chars_used - len(header) - 50
                if remaining > 200:
                    truncated = content[:remaining]
                    block = f"{header}\n{truncated}\n... (truncated)\n"
                    parts.append(block)
                break

            parts.append(block)
            chars_used += block_chars

        return "\n".join(parts)

    def build_file_context(self, file_path: str | Path) -> str:
        """Build context from a single file (for explain/review commands)."""
        path = Path(file_path).resolve()
        content = self._read_file(path)
        if content is None:
            return f"(Cannot read file: {file_path})"

        # Truncate if too long
        if len(content) > self.max_chars:
            content = content[: self.max_chars] + "\n... (truncated)"

        return f"=== File: {path.name} ===\n{content}\n"

    @staticmethod
    def _read_file(path: Path) -> str | None:
        """Safely read a text file."""
        try:
            return path.read_text(encoding="utf-8", errors="ignore")
        except (OSError, UnicodeDecodeError):
            return None
