"""CLI Interface — main entry point for agent-code commands."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

import typer
from rich.console import Console
from rich.markdown import Markdown
from rich.panel import Panel
from rich.syntax import Syntax
from rich.table import Table

from agent_code.agent import Agent
from agent_code.config import Settings
from agent_code.context import ContextBuilder
from agent_code.git_handler import GitHandler, GitError
from agent_code.llm import LLMClient, LLMError
from agent_code.patcher import PatchGenerator
from agent_code.scanner import ProjectScanner

app = typer.Typer(
    name="agent-code",
    help="AI-powered CLI coding assistant using local LLM (DeepSeek-Coder via Ollama)",
    no_args_is_help=True,
)
console = Console()


def _get_project_root() -> Path:
    """Resolve the project root (current working directory)."""
    return Path.cwd().resolve()


def _check_ollama(client: LLMClient) -> None:
    """Verify Ollama is reachable, abort if not."""
    if not client.check_connection():
        console.print(
            "[bold red]✗ Cannot connect to Ollama![/bold red]\n"
            f"  URL: {client.base_url}\n"
            "  Make sure Ollama is running: [cyan]ollama serve[/cyan]"
        )
        raise typer.Exit(1)


def _display_diff(diff_text: str, filename: str) -> None:
    """Display a syntax-highlighted diff in a panel."""
    if not diff_text.strip():
        console.print(f"  [dim]No changes for {filename}[/dim]")
        return
    syntax = Syntax(diff_text, "diff", theme="monokai", line_numbers=False)
    console.print(Panel(syntax, title=f" {filename}", border_style="green"))


def _confirm_apply() -> bool:
    """Ask user to confirm applying changes."""
    return typer.confirm("Apply these changes?", default=False)


# =====================================================================
# EDIT command
# =====================================================================
@app.command()
def edit(
    instruction: str = typer.Argument(..., help="What to edit, e.g. 'add logging to all functions'"),
    file: Optional[str] = typer.Option(None, "--file", "-f", help="Target file path"),
    no_git: bool = typer.Option(False, "--no-git", help="Skip Git branch/commit"),
) -> None:
    """Edit existing code based on natural language instruction."""
    root = _get_project_root()
    settings = Settings.load()
    client = LLMClient(settings)
    _check_ollama(client)

    with console.status("[bold cyan]Scanning project…[/bold cyan]"):
        scanner = ProjectScanner(settings)
        scan = scanner.scan_project(root)
        relevant = scanner.find_relevant_files(instruction, scan, target_file=file)

    if not relevant and not file:
        console.print("[yellow]⚠ No relevant files found. Use --file to specify a target.[/yellow]")
        raise typer.Exit(1)

    with console.status("[bold cyan]Building context…[/bold cyan]"):
        ctx_builder = ContextBuilder(settings)
        if file:
            context = ctx_builder.build_file_context(file)
        else:
            context = ctx_builder.build_context(relevant, instruction, project_root=root)

    agent = Agent()
    system_prompt, user_prompt = agent.create_prompt(
        "edit", instruction, context=context, tree=scan.tree_text,
    )

    console.print(f"\n[bold] Asking LLM to: [cyan]{instruction}[/cyan][/bold]\n")
    try:
        response = client.generate(user_prompt, system=system_prompt)
    except LLMError as exc:
        console.print(f"[bold red]✗ LLM Error:[/bold red] {exc}")
        raise typer.Exit(1)

    # Parse response and generate diffs
    patcher = PatchGenerator()
    changes = patcher.parse_llm_response(response)

    if not changes:
        console.print("[yellow]⚠ LLM did not return any code changes.[/yellow]")
        raise typer.Exit(0)

    console.print(f"\n[bold green]✓ {len(changes)} file(s) modified:[/bold green]\n")
    for change in changes:
        diff = patcher.generate_diff(change, project_root=root)
        _display_diff(diff, change.filename)

    # Confirm & apply
    if not _confirm_apply():
        console.print("[dim]Changes discarded.[/dim]")
        raise typer.Exit(0)

    # Git branch + apply
    if not no_git:
        try:
            git = GitHandler(root)
            if git.is_git_repo():
                branch = git.create_branch(instruction[:40])
                console.print(f"[cyan] Created branch: {branch}[/cyan]")
        except GitError as exc:
            console.print(f"[yellow]⚠ Git: {exc}[/yellow]")

    modified = patcher.apply_changes(changes, root)

    if not no_git:
        try:
            git = GitHandler(root)
            if git.is_git_repo():
                rel_files = [str(p.relative_to(root)) for p in modified]
                sha = git.commit_changes(rel_files, instruction[:72])
                console.print(f"[green]✓ Committed: {sha}[/green]")
        except GitError as exc:
            console.print(f"[yellow]⚠ Git commit skipped: {exc}[/yellow]")

    console.print(f"\n[bold green]✓ Applied changes to {len(modified)} file(s)[/bold green]")


# =====================================================================
# EXPLAIN command
# =====================================================================
@app.command()
def explain(
    file: str = typer.Option(..., "--file", "-f", help="File to explain"),
) -> None:
    """Explain what a code file does."""
    settings = Settings.load()
    client = LLMClient(settings)
    _check_ollama(client)

    file_path = Path(file).resolve()
    if not file_path.exists():
        console.print(f"[bold red]✗ File not found: {file}[/bold red]")
        raise typer.Exit(1)

    with console.status("[bold cyan]Reading file…[/bold cyan]"):
        ctx_builder = ContextBuilder(settings)
        context = ctx_builder.build_file_context(file_path)

    root = _get_project_root()
    scanner = ProjectScanner(settings)
    scan = scanner.scan_project(root)

    agent = Agent()
    system_prompt, user_prompt = agent.create_prompt(
        "explain",
        f"Explain the file: {file}",
        context=context,
        tree=scan.tree_text,
    )

    console.print(f"\n[bold] Explaining: [cyan]{file}[/cyan][/bold]\n")
    try:
        response = client.generate(user_prompt, system=system_prompt)
    except LLMError as exc:
        console.print(f"[bold red]✗ LLM Error:[/bold red] {exc}")
        raise typer.Exit(1)

    console.print("\n")
    console.print(Panel(Markdown(response), title="Explanation", border_style="blue"))


# =====================================================================
# REVIEW command
# =====================================================================
@app.command()
def review(
    file: str = typer.Option(..., "--file", "-f", help="File to review"),
) -> None:
    """Review code for bugs, security issues, and improvements."""
    settings = Settings.load()
    client = LLMClient(settings)
    _check_ollama(client)

    file_path = Path(file).resolve()
    if not file_path.exists():
        console.print(f"[bold red]✗ File not found: {file}[/bold red]")
        raise typer.Exit(1)

    with console.status("[bold cyan]Reading file…[/bold cyan]"):
        ctx_builder = ContextBuilder(settings)
        context = ctx_builder.build_file_context(file_path)

    root = _get_project_root()
    scanner = ProjectScanner(settings)
    scan = scanner.scan_project(root)

    agent = Agent()
    system_prompt, user_prompt = agent.create_prompt(
        "review",
        f"Review the file: {file}",
        context=context,
        tree=scan.tree_text,
    )

    console.print(f"\n[bold]🔎 Reviewing: [cyan]{file}[/cyan][/bold]\n")
    try:
        response = client.generate(user_prompt, system=system_prompt)
    except LLMError as exc:
        console.print(f"[bold red]✗ LLM Error:[/bold red] {exc}")
        raise typer.Exit(1)

    console.print("\n")
    console.print(Panel(Markdown(response), title=" Code Review", border_style="yellow"))


# =====================================================================
# GENERATE command
# =====================================================================
@app.command()
def generate(
    instruction: str = typer.Argument(..., help="What to generate, e.g. 'FastAPI server with /users endpoint'"),
    no_git: bool = typer.Option(False, "--no-git", help="Skip Git branch/commit"),
) -> None:
    """Generate new code files from a natural language description."""
    root = _get_project_root()
    settings = Settings.load()
    client = LLMClient(settings)
    _check_ollama(client)

    # Scan project for context (optional, helps LLM match style)
    with console.status("[bold cyan]Scanning project…[/bold cyan]"):
        scanner = ProjectScanner(settings)
        scan = scanner.scan_project(root)
        ctx_builder = ContextBuilder(settings)
        relevant = scanner.find_relevant_files(instruction, scan, max_files=3)
        context = ctx_builder.build_context(relevant, instruction, project_root=root) if relevant else ""

    agent = Agent()
    system_prompt, user_prompt = agent.create_prompt(
        "generate", instruction, context=context, tree=scan.tree_text,
    )

    console.print(f"\n[bold]Generating: [cyan]{instruction}[/cyan][/bold]\n")
    try:
        response = client.generate(user_prompt, system=system_prompt)
    except LLMError as exc:
        console.print(f"[bold red]✗ LLM Error:[/bold red] {exc}")
        raise typer.Exit(1)

    # Parse generated files
    patcher = PatchGenerator()
    changes = patcher.parse_llm_response(response)

    if not changes:
        console.print("[yellow]⚠ LLM did not generate any files.[/yellow]")
        raise typer.Exit(0)

    console.print(f"\n[bold green]✓ {len(changes)} file(s) generated:[/bold green]\n")
    for change in changes:
        syntax = Syntax(change.new_content, change.filename.split(".")[-1] if "." in change.filename else "text",
                        theme="monokai", line_numbers=True)
        console.print(Panel(syntax, title=f" {change.filename}", border_style="green"))

    if not _confirm_apply():
        console.print("[dim]Files not created.[/dim]")
        raise typer.Exit(0)

    # Apply & git
    if not no_git:
        try:
            git = GitHandler(root)
            if git.is_git_repo():
                branch = git.create_branch(instruction[:40])
                console.print(f"[cyan] Created branch: {branch}[/cyan]")
        except GitError as exc:
            console.print(f"[yellow]⚠ Git: {exc}[/yellow]")

    modified = patcher.apply_changes(changes, root)

    if not no_git:
        try:
            git = GitHandler(root)
            if git.is_git_repo():
                rel_files = [str(p.relative_to(root)) for p in modified]
                sha = git.commit_changes(rel_files, f"generate: {instruction[:60]}")
                console.print(f"[green]✓ Committed: {sha}[/green]")
        except GitError as exc:
            console.print(f"[yellow]⚠ Git commit skipped: {exc}[/yellow]")

    console.print(f"\n[bold green]✓ Created {len(modified)} file(s)[/bold green]")


# =====================================================================
# CONFIG command
# =====================================================================
@app.command()
def config(
    show: bool = typer.Option(False, "--show", "-s", help="Show current configuration"),
    model: Optional[str] = typer.Option(None, "--model", "-m", help="Set LLM model name"),
    url: Optional[str] = typer.Option(None, "--url", "-u", help="Set Ollama server URL"),
    temperature: Optional[float] = typer.Option(None, "--temperature", "-t", help="Set temperature"),
) -> None:
    """View or update agent-code configuration."""
    settings = Settings.load()
    changed = False

    if model:
        settings.model = model
        changed = True
    if url:
        settings.ollama_url = url
        changed = True
    if temperature is not None:
        settings.temperature = temperature
        changed = True

    if changed:
        settings.save()
        console.print("[green]✓ Configuration updated[/green]")

    if show or not changed:
        table = Table(title="Agent Code Configuration", border_style="cyan")
        table.add_column("Setting", style="bold")
        table.add_column("Value", style="cyan")

        table.add_row("Ollama URL", settings.ollama_url)
        table.add_row("Model", settings.model)
        table.add_row("Max Context Tokens", str(settings.max_context_tokens))
        table.add_row("Max Scan Depth", str(settings.max_scan_depth))
        table.add_row("Temperature", str(settings.temperature))
        table.add_row("Config File", str(Settings.config_file()))

        console.print(table)

        # Check Ollama connection
        client = LLMClient(settings)
        if client.check_connection():
            models = client.list_models()
            console.print(f"\n[green]✓ Ollama connected[/green]  ({len(models)} models available)")
        else:
            console.print(f"\n[red]✗ Ollama not reachable at {settings.ollama_url}[/red]")


# =====================================================================
# Entry point
# =====================================================================
if __name__ == "__main__":
    app()
