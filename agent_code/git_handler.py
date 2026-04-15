"""Git Handler — manage branches and commits for code changes."""

from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path

from git import Repo, InvalidGitRepositoryError, GitCommandError
from git.exc import NoSuchPathError


class GitError(Exception):
    """Raised when a Git operation fails."""


class GitHandler:
    """Manage Git operations: branch creation, commits, status checks."""

    def __init__(self, project_root: str | Path):
        self.root = Path(project_root).resolve()
        self._repo: Repo | None = None

    @property
    def repo(self) -> Repo:
        """Lazily initialize Git repo reference."""
        if self._repo is None:
            try:
                self._repo = Repo(self.root, search_parent_directories=True)
            except (InvalidGitRepositoryError, NoSuchPathError) as exc:
                raise GitError(
                    f"Not a Git repository: {self.root}\n"
                    f"Run `git init` first."
                ) from exc
        return self._repo

    def is_git_repo(self) -> bool:
        """Check if the project is inside a Git repository."""
        try:
            _ = self.repo
            return True
        except GitError:
            return False

    def get_status(self) -> dict[str, list[str]]:
        """Get working directory status.

        Returns dict with keys: 'modified', 'untracked', 'staged'.
        """
        return {
            "modified": [item.a_path for item in self.repo.index.diff(None)],
            "untracked": list(self.repo.untracked_files),
            "staged": [item.a_path for item in self.repo.index.diff("HEAD")],
        }

    def is_clean(self) -> bool:
        """Check if working directory is clean (no uncommitted changes)."""
        return not self.repo.is_dirty(untracked_files=True)

    def current_branch(self) -> str:
        """Get the current branch name."""
        try:
            return str(self.repo.active_branch)
        except TypeError:
            return "HEAD (detached)"

    def create_branch(
        self,
        description: str,
        *,
        checkout: bool = True,
    ) -> str:
        """Create a new branch for the AI changes.

        Branch name format: agent-code/<timestamp>-<description>
        """
        # Sanitize description for branch name
        safe_desc = re.sub(r"[^a-z0-9]+", "-", description.lower())
        safe_desc = safe_desc.strip("-")[:30]
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        branch_name = f"agent-code/{timestamp}-{safe_desc}"

        try:
            new_branch = self.repo.create_head(branch_name)
            if checkout:
                new_branch.checkout()
            return branch_name
        except GitCommandError as exc:
            raise GitError(f"Failed to create branch: {exc}") from exc

    def commit_changes(
        self,
        files: list[str | Path],
        message: str,
    ) -> str:
        """Stage files and create a commit.

        Returns the commit SHA.
        """
        try:
            # Stage specific files
            str_files = [str(f) for f in files]
            self.repo.index.add(str_files)

            # Commit
            commit = self.repo.index.commit(
                f"agent-code: {message}"
            )
            return str(commit.hexsha)[:8]
        except GitCommandError as exc:
            raise GitError(f"Failed to commit: {exc}") from exc

    def checkout_previous_branch(self) -> str:
        """Switch back to the previous branch (before agent-code branch)."""
        try:
            # Use git checkout - (previous branch)
            self.repo.git.checkout("-")
            return self.current_branch()
        except GitCommandError as exc:
            raise GitError(f"Failed to checkout previous branch: {exc}") from exc
