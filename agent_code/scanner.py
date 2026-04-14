"""Project Scanner — discover and filter relevant files."""

from __future__ import annotations

import fnmatch
from pathlib import Path
from dataclasses import dataclass, field

from agent_code.config import Settings

# File extensions we consider "source code"
CODE_EXTENSIONS: set[str] = {
    ".py", ".js", ".ts", ".jsx", ".tsx",
    ".java", ".go", ".rs", ".rb", ".php",
    ".c", ".cpp", ".h", ".hpp", ".cs",
    ".html", ".css", ".scss", ".vue", ".svelte",
    ".yaml", ".yml", ".toml", ".json", ".xml",
    ".sql", ".sh", ".bash", ".zsh",
    ".md", ".txt", ".rst",
    ".dockerfile", ".env",
}

# Directories to always skip
SKIP_DIRS: set[str] = {
    ".git", "__pycache__", "node_modules", ".venv", "venv",
    "env", ".env", ".tox", ".mypy_cache", ".pytest_cache",
    "dist", "build", ".eggs", "*.egg-info",
    ".idea", ".vscode", ".vs",
}

# Files to always skip
SKIP_FILES: set[str] = {
    ".DS_Store", "Thumbs.db", "*.pyc", "*.pyo",
    "*.so", "*.dylib", "*.dll", "*.exe",
    "*.lock", "package-lock.json", "yarn.lock",
}


@dataclass
class FileInfo:
    """Metadata for a discovered file."""
    path: Path
    relative_path: str
    extension: str
    size: int
    lines: int = 0


@dataclass
class ScanResult:
    """Result of scanning a project directory."""
    root: Path
    files: list[FileInfo] = field(default_factory=list)
    tree_text: str = ""
    total_files: int = 0


class ProjectScanner:
    """Scan project directory and find relevant files for an instruction."""

    def __init__(self, settings: Settings | None = None):
        self.settings = settings or Settings.load()
        self._gitignore_patterns: list[str] = []

    def scan_project(self, root_dir: str | Path) -> ScanResult:
        """Scan project directory and return file listing."""
        root = Path(root_dir).resolve()
        if not root.is_dir():
            raise FileNotFoundError(f"Directory not found: {root}")

        # Load .gitignore if present
        self._load_gitignore(root)

        files: list[FileInfo] = []
        tree_lines: list[str] = [f"📁 {root.name}/"]

        self._walk(root, root, files, tree_lines, depth=0)

        return ScanResult(
            root=root,
            files=files,
            tree_text="\n".join(tree_lines),
            total_files=len(files),
        )

    def find_relevant_files(
        self,
        instruction: str,
        scan_result: ScanResult,
        *,
        target_file: str | None = None,
        max_files: int = 10,
    ) -> list[FileInfo]:
        """Find files most relevant to the given instruction.

        Uses keyword matching + file extension heuristics.
        If *target_file* is specified, it is always included first.
        """
        results: list[FileInfo] = []
        all_files = scan_result.files

        # 1. If a specific file is targeted, prioritize it
        if target_file:
            target_path = Path(target_file)
            for f in all_files:
                if f.path == target_path.resolve() or f.relative_path == target_file:
                    results.append(f)
                    break

        # 2. Extract keywords from instruction
        keywords = self._extract_keywords(instruction)

        # 3. Score each file by keyword match
        scored: list[tuple[float, FileInfo]] = []
        for f in all_files:
            if f in results:
                continue
            score = self._score_file(f, keywords)
            if score > 0:
                scored.append((score, f))

        # Sort by score descending
        scored.sort(key=lambda x: x[0], reverse=True)

        # Take top N
        remaining = max_files - len(results)
        for _score, f in scored[:remaining]:
            results.append(f)

        return results

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _walk(
        self,
        current: Path,
        root: Path,
        files: list[FileInfo],
        tree_lines: list[str],
        depth: int,
    ) -> None:
        """Recursively walk directory tree."""
        if depth > self.settings.max_scan_depth:
            return

        try:
            entries = sorted(current.iterdir(), key=lambda p: (p.is_file(), p.name.lower()))
        except PermissionError:
            return

        for entry in entries:
            relative = str(entry.relative_to(root))

            if entry.is_dir():
                if self._should_skip_dir(entry.name, relative):
                    continue
                indent = "  " * (depth + 1)
                tree_lines.append(f"{indent}📁 {entry.name}/")
                self._walk(entry, root, files, tree_lines, depth + 1)
            elif entry.is_file():
                if self._should_skip_file(entry.name, relative):
                    continue
                ext = entry.suffix.lower()
                if ext not in CODE_EXTENSIONS and ext != "":
                    continue

                try:
                    size = entry.stat().st_size
                except OSError:
                    size = 0

                # Count lines for text files
                lines = 0
                if size > 0 and size < 1_000_000:  # skip files > 1MB
                    try:
                        lines = len(entry.read_text(encoding="utf-8", errors="ignore").splitlines())
                    except Exception:
                        pass

                info = FileInfo(
                    path=entry,
                    relative_path=relative,
                    extension=ext,
                    size=size,
                    lines=lines,
                )
                files.append(info)

                indent = "  " * (depth + 1)
                tree_lines.append(f"{indent}📄 {entry.name} ({lines}L)")

    def _should_skip_dir(self, name: str, relative: str) -> bool:
        """Check if directory should be skipped."""
        for pattern in SKIP_DIRS:
            if fnmatch.fnmatch(name, pattern):
                return True
        return self._matches_gitignore(relative + "/")

    def _should_skip_file(self, name: str, relative: str) -> bool:
        """Check if file should be skipped."""
        for pattern in SKIP_FILES:
            if fnmatch.fnmatch(name, pattern):
                return True
        return self._matches_gitignore(relative)

    def _load_gitignore(self, root: Path) -> None:
        """Load .gitignore patterns from project root."""
        gitignore = root / ".gitignore"
        self._gitignore_patterns = []
        if gitignore.exists():
            try:
                for line in gitignore.read_text(encoding="utf-8").splitlines():
                    line = line.strip()
                    if line and not line.startswith("#"):
                        self._gitignore_patterns.append(line)
            except Exception:
                pass

    def _matches_gitignore(self, relative: str) -> bool:
        """Check if path matches any .gitignore pattern."""
        for pattern in self._gitignore_patterns:
            if fnmatch.fnmatch(relative, pattern):
                return True
            if fnmatch.fnmatch(relative, f"**/{pattern}"):
                return True
        return False

    def _extract_keywords(self, instruction: str) -> list[str]:
        """Extract meaningful keywords from instruction."""
        # Remove common stop words
        stop_words = {
            "a", "an", "the", "and", "or", "but", "in", "on", "at",
            "to", "for", "of", "with", "by", "is", "it", "this",
            "that", "from", "as", "add", "edit", "fix", "update",
            "create", "make", "change", "modify", "remove", "delete",
            "all", "each", "every", "into", "code", "file", "function",
        }
        words = instruction.lower().split()
        return [w for w in words if w not in stop_words and len(w) > 1]

    def _score_file(self, file_info: FileInfo, keywords: list[str]) -> float:
        """Score a file by how relevant it is to keywords."""
        score = 0.0
        name_lower = file_info.relative_path.lower()

        for kw in keywords:
            # Filename/path match (strongest signal)
            if kw in name_lower:
                score += 3.0

        # Bonus for common entry-point files
        basename = file_info.path.name.lower()
        if basename in ("main.py", "app.py", "index.py", "server.py", "__init__.py"):
            score += 0.5

        # Slight bonus for Python files (since the project is Python)
        if file_info.extension == ".py":
            score += 0.2

        return score
