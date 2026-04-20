/**
 * Context Builder — gathers relevant code context from workspace and editor.
 *
 * Provides:
 * - Single file context (from selection or document)
 * - Inline completion context (surrounding code)
 * - Deep project tree scanning (recursive directory listing)
 * - Multi-file reading (gather contents of key project files)
 * - Project summary building (tree + key file contents for LLM)
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getConfig } from './config';

/** Directories to always ignore when scanning. */
const IGNORE_DIRS = new Set([
    'node_modules', '.git', '__pycache__', '.vscode', '.idea',
    'dist', 'build', 'out', '.next', '.nuxt', 'coverage',
    '.mypy_cache', '.pytest_cache', 'venv', '.venv', 'env',
    '.tox', '.eggs',
]);

const IGNORE_FILES = new Set([
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
    '.DS_Store', 'Thumbs.db',
]);

/** Source code extensions we want to read. */
const CODE_EXTENSIONS = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs',
    '.c', '.cpp', '.h', '.hpp', '.cs', '.rb', '.php', '.swift',
    '.kt', '.scala', '.vue', '.svelte', '.html', '.css', '.scss',
    '.sql', '.sh', '.bash', '.yaml', '.yml', '.toml', '.json',
    '.xml', '.md', '.txt', '.env', '.cfg', '.ini', '.conf',
]);

export class ContextBuilder {

    // ── Single File Context ──────────────────────────────────────

    static fromSelection(editor: vscode.TextEditor): string {
        const selection = editor.selection;
        const doc = editor.document;

        if (!selection.isEmpty) {
            const selectedText = doc.getText(selection);
            const startLine = selection.start.line + 1;
            return `=== File: ${doc.fileName} (lines ${startLine}-${selection.end.line + 1}) ===\n${selectedText}\n`;
        }

        return this.fromDocument(doc);
    }

    static fromDocument(doc: vscode.TextDocument): string {
        const cfg = getConfig();
        const totalLines = doc.lineCount;
        const maxLines = cfg.maxContextLines;

        let content: string;
        if (totalLines <= maxLines) {
            content = doc.getText();
        } else {
            const halfMax = Math.floor(maxLines / 2);
            const firstPart = doc.getText(new vscode.Range(0, 0, halfMax, 0));
            const lastPart = doc.getText(new vscode.Range(totalLines - halfMax, 0, totalLines, 0));
            content = firstPart + `\n... (${totalLines - maxLines} lines omitted) ...\n` + lastPart;
        }

        return `=== File: ${doc.fileName} ===\n${content}\n`;
    }

    // ── Inline Completion Context ────────────────────────────────

    static forInlineCompletion(doc: vscode.TextDocument, position: vscode.Position): { prefix: string; suffix: string } {
        const cfg = getConfig();
        const halfLines = Math.floor(cfg.maxContextLines / 2);

        const prefixStart = Math.max(0, position.line - halfLines);
        const prefixRange = new vscode.Range(prefixStart, 0, position.line, position.character);
        const prefix = doc.getText(prefixRange);

        const suffixEnd = Math.min(doc.lineCount, position.line + halfLines);
        const suffixRange = new vscode.Range(position.line, position.character, suffixEnd, 0);
        const suffix = doc.getText(suffixRange);

        return { prefix, suffix };
    }

    // ── Deep Project Tree ────────────────────────────────────────

    /**
     * Get a recursive project tree (up to maxDepth levels deep).
     */
    static async getProjectTree(maxDepth: number = 4): Promise<string> {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            return '(no workspace open)';
        }

        const rootPath = folders[0].uri.fsPath;
        const rootName = folders[0].name;
        const lines: string[] = [`📁 ${rootName}/`];

        this.scanDirSync(rootPath, '', 1, maxDepth, lines);

        return lines.join('\n');
    }

    private static scanDirSync(
        absDir: string,
        indent: string,
        currentDepth: number,
        maxDepth: number,
        lines: string[],
    ): void {
        if (currentDepth > maxDepth) { return; }

        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(absDir, { withFileTypes: true });
        } catch {
            return;
        }

        // Sort: directories first, then alphabetically
        entries.sort((a, b) => {
            if (a.isDirectory() !== b.isDirectory()) {
                return a.isDirectory() ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });

        for (const entry of entries) {
            if (entry.name.startsWith('.') && entry.name !== '.env') { continue; }
            if (IGNORE_DIRS.has(entry.name)) { continue; }
            if (IGNORE_FILES.has(entry.name)) { continue; }

            if (entry.isDirectory()) {
                lines.push(`${indent}  📁 ${entry.name}/`);
                this.scanDirSync(
                    path.join(absDir, entry.name),
                    indent + '  ',
                    currentDepth + 1,
                    maxDepth,
                    lines,
                );
            } else {
                lines.push(`${indent}  📄 ${entry.name}`);
            }

            // Cap total entries to prevent massive output
            if (lines.length > 200) {
                lines.push(`${indent}  ... (truncated)`);
                return;
            }
        }
    }

    // ── Multi-File Reading ───────────────────────────────────────

    /**
     * Read the contents of multiple files, capped per-file and total.
     */
    static readFiles(
        filePaths: string[],
        maxLinesPerFile: number = 80,
        maxTotalChars: number = 30000,
    ): string {
        const parts: string[] = [];
        let totalChars = 0;

        for (const filePath of filePaths) {
            if (totalChars >= maxTotalChars) {
                parts.push(`\n... (context limit reached, ${filePaths.length - parts.length} files skipped)`);
                break;
            }

            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                const lines = content.split('\n');
                let trimmed: string;

                if (lines.length <= maxLinesPerFile) {
                    trimmed = content;
                } else {
                    const half = Math.floor(maxLinesPerFile / 2);
                    trimmed = lines.slice(0, half).join('\n')
                        + `\n... (${lines.length - maxLinesPerFile} lines omitted) ...\n`
                        + lines.slice(-half).join('\n');
                }

                const entry = `\n=== File: ${filePath} (${lines.length} lines) ===\n${trimmed}\n`;
                parts.push(entry);
                totalChars += entry.length;
            } catch {
                // skip unreadable files
            }
        }

        return parts.join('');
    }

    /**
     * Find and read all source code files in the workspace.
     */
    static async readProjectFiles(
        maxFiles: number = 30,
        maxLinesPerFile: number = 60,
        maxTotalChars: number = 25000,
    ): Promise<string> {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            return '(no workspace open)';
        }

        const rootPath = folders[0].uri.fsPath;
        const codeFiles = this.findCodeFiles(rootPath, maxFiles);

        if (codeFiles.length === 0) {
            return '(no source files found)';
        }

        return this.readFiles(codeFiles, maxLinesPerFile, maxTotalChars);
    }

    /**
     * Find source code files in a directory (recursive).
     * Priority files (package.json, etc.) come first.
     */
    static findCodeFiles(rootPath: string, maxFiles: number = 30): string[] {
        const files: string[] = [];
        this.collectCodeFiles(rootPath, files, 0, 5);

        // Sort by depth (root-level files first)
        files.sort((a, b) => {
            const depthA = a.split(path.sep).length;
            const depthB = b.split(path.sep).length;
            if (depthA !== depthB) { return depthA - depthB; }
            return a.localeCompare(b);
        });

        // Prioritize config/key files
        const priorityFiles = [
            'package.json', 'tsconfig.json', 'pyproject.toml', 'Cargo.toml',
            'go.mod', 'Makefile', 'Dockerfile', 'docker-compose.yml',
            'README.md', '.env.example',
        ];

        const important: string[] = [];
        const rest: string[] = [];
        for (const f of files) {
            const base = path.basename(f);
            if (priorityFiles.includes(base)) {
                important.push(f);
            } else {
                rest.push(f);
            }
        }

        return [...important, ...rest].slice(0, maxFiles);
    }

    private static collectCodeFiles(
        dir: string,
        result: string[],
        depth: number,
        maxDepth: number,
    ): void {
        if (depth > maxDepth) { return; }

        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            if (entry.name.startsWith('.') && entry.name !== '.env' && entry.name !== '.env.example') {
                continue;
            }
            if (IGNORE_DIRS.has(entry.name)) { continue; }
            if (IGNORE_FILES.has(entry.name)) { continue; }

            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                this.collectCodeFiles(fullPath, result, depth + 1, maxDepth);
            } else {
                const ext = path.extname(entry.name).toLowerCase();
                if (CODE_EXTENSIONS.has(ext)) {
                    // Skip very large files (>100KB)
                    try {
                        const stat = fs.statSync(fullPath);
                        if (stat.size < 100_000) {
                            result.push(fullPath);
                        }
                    } catch {
                        // skip
                    }
                }
            }
        }
    }

    // ── Smart Context Gathering ──────────────────────────────────

    /**
     * Build a comprehensive project summary (tree + key files).
     */
    static async buildProjectSummary(): Promise<string> {
        const tree = await this.getProjectTree(4);
        const files = await this.readProjectFiles(30, 60, 25000);
        return `# Project Structure\n\n${tree}\n\n# Source Files\n${files}`;
    }

    /**
     * Smart context: gather context based on what's available.
     * - If user has selection → selected code
     * - If file is open → active file + project tree
     * - If no file open → full project scan
     */
    static async gatherSmartContext(): Promise<{ context: string; source: string }> {
        const editor = vscode.window.activeTextEditor;

        if (editor && !editor.selection.isEmpty) {
            const code = this.fromSelection(editor);
            return { context: code, source: `selection in ${path.basename(editor.document.fileName)}` };
        }

        if (editor) {
            const fileContext = this.fromDocument(editor.document);
            const tree = await this.getProjectTree(3);
            return {
                context: `# Active File\n${fileContext}\n\n# Project Tree\n${tree}`,
                source: path.basename(editor.document.fileName),
            };
        }

        // No file open — scan entire project
        const summary = await this.buildProjectSummary();
        return { context: summary, source: 'full project scan' };
    }
}
