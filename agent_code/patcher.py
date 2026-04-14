"""Patch Generator — parse LLM output, create diffs, apply changes."""

from __future__ import annotations

import difflib
import re
from dataclasses import dataclass
from pathlib import Path


@dataclass
class FileChange:
    """Represents a change to a single file."""
    filename: str
    new_content: str
    original_content: str = ""
    diff_text: str = ""


class PatchGenerator:
    """Parse LLM responses into file changes and generate unified diffs."""

    # Regex to extract fenced code blocks: ```filename\ncontent\n```
    CODE_BLOCK_RE = re.compile(
        r"```([^\n`]+)\n(.*?)```",
        re.DOTALL,
    )

    def parse_llm_response(self, response: str) -> list[FileChange]:
        """Extract file changes from LLM response.

        Expects code blocks formatted as:
            ```path/to/file.py
            ... code content ...
            ```

        Returns a list of FileChange objects.
        """
        changes: list[FileChange] = []
        seen: set[str] = set()

        for match in self.CODE_BLOCK_RE.finditer(response):
            filename = match.group(1).strip()
            content = match.group(2)

            # Skip non-filename code blocks (like "python", "bash", etc.)
            if self._is_language_tag(filename):
                continue

            # Normalize filename
            filename = filename.lstrip("./")

            if filename in seen:
                continue
            seen.add(filename)

            changes.append(FileChange(
                filename=filename,
                new_content=content,
            ))

        return changes

    def generate_diff(
        self,
        change: FileChange,
        *,
        project_root: Path | None = None,
    ) -> str:
        """Generate a unified diff for a file change.

        If *project_root* is provided, tries to read the original file.
        """
        # Try to load original content
        original_lines: list[str] = []
        if project_root:
            original_path = project_root / change.filename
            if original_path.exists():
                try:
                    original_text = original_path.read_text(encoding="utf-8")
                    original_lines = original_text.splitlines(keepends=True)
                    change.original_content = original_text
                except Exception:
                    pass

        new_lines = change.new_content.splitlines(keepends=True)
        # Ensure lines end with newline
        if new_lines and not new_lines[-1].endswith("\n"):
            new_lines[-1] += "\n"

        diff = difflib.unified_diff(
            original_lines,
            new_lines,
            fromfile=f"a/{change.filename}",
            tofile=f"b/{change.filename}",
            lineterm="",
        )

        diff_text = "\n".join(diff)
        change.diff_text = diff_text
        return diff_text

    def apply_changes(
        self,
        changes: list[FileChange],
        project_root: Path,
    ) -> list[Path]:
        """Write modified files to disk.

        Returns list of modified file paths.
        """
        modified_paths: list[Path] = []

        for change in changes:
            target = project_root / change.filename
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(change.new_content, encoding="utf-8")
            modified_paths.append(target)

        return modified_paths

    @staticmethod
    def _is_language_tag(tag: str) -> bool:
        """Check if a code block tag is a language name (not a filename)."""
        language_tags = {
            "python", "javascript", "typescript", "java", "go", "rust",
            "ruby", "php", "c", "cpp", "csharp", "html", "css", "scss",
            "json", "yaml", "yml", "toml", "xml", "sql", "bash", "sh",
            "shell", "zsh", "markdown", "md", "text", "txt", "diff",
            "dockerfile", "makefile", "plaintext",
        }
        return tag.lower() in language_tags
