/**
 * Verifier — auto-checks code after changes are applied.
 *
 * Detects project type and runs appropriate build/lint commands.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';

export interface VerificationResult {
    success: boolean;
    output: string;
    errors: string[];
    command: string;
}

export class Verifier {
    /**
     * Run verification commands for the current workspace.
     * Returns results for each verification command.
     */
    async verify(commands?: string[]): Promise<VerificationResult[]> {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            return [{
                success: true,
                output: 'No workspace open — skipping verification.',
                errors: [],
                command: 'none',
            }];
        }

        const cmds = commands && commands.length > 0
            ? commands
            : this.detectVerificationCommands(workspaceRoot);

        if (cmds.length === 0) {
            return [{
                success: true,
                output: 'No verification commands detected.',
                errors: [],
                command: 'none',
            }];
        }

        const results: VerificationResult[] = [];
        for (const cmd of cmds) {
            const result = await this.runCommand(cmd, workspaceRoot);
            results.push(result);
        }

        return results;
    }

    /**
     * Detect appropriate verification commands based on project files.
     */
    private detectVerificationCommands(root: string): string[] {
        const commands: string[] = [];

        // TypeScript / Node.js project
        if (fs.existsSync(path.join(root, 'tsconfig.json'))) {
            if (fs.existsSync(path.join(root, 'package.json'))) {
                try {
                    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
                    if (pkg.scripts?.compile) {
                        commands.push('npm run compile');
                    } else if (pkg.scripts?.build) {
                        commands.push('npm run build');
                    } else {
                        commands.push('npx tsc --noEmit');
                    }
                } catch {
                    commands.push('npx tsc --noEmit');
                }
            } else {
                commands.push('npx tsc --noEmit');
            }
        }
        // JavaScript project (no TS)
        else if (fs.existsSync(path.join(root, 'package.json'))) {
            try {
                const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
                if (pkg.scripts?.lint) {
                    commands.push('npm run lint');
                }
                if (pkg.scripts?.test) {
                    commands.push('npm test');
                }
            } catch {
                // skip
            }
        }

        // Python project
        if (fs.existsSync(path.join(root, 'pyproject.toml')) || fs.existsSync(path.join(root, 'setup.py'))) {
            commands.push('python -m py_compile');
        }

        // Go project
        if (fs.existsSync(path.join(root, 'go.mod'))) {
            commands.push('go build ./...');
        }

        // Rust project
        if (fs.existsSync(path.join(root, 'Cargo.toml'))) {
            commands.push('cargo check');
        }

        return commands;
    }

    /**
     * Run a shell command and capture output.
     */
    private runCommand(command: string, cwd: string): Promise<VerificationResult> {
        return new Promise((resolve) => {
            exec(command, { cwd, timeout: 60_000 }, (error, stdout, stderr) => {
                const output = (stdout + '\n' + stderr).trim();
                const errors = this.parseErrors(output);

                resolve({
                    success: !error,
                    output,
                    errors,
                    command,
                });
            });
        });
    }

    /**
     * Extract error messages from build output.
     */
    private parseErrors(output: string): string[] {
        const errors: string[] = [];
        const lines = output.split('\n');

        for (const line of lines) {
            const trimmed = line.trim();
            // Common error patterns
            if (
                trimmed.match(/error\s*(TS\d+)?:/i) ||
                trimmed.match(/Error:/i) ||
                trimmed.match(/SyntaxError/i) ||
                trimmed.match(/TypeError/i) ||
                trimmed.match(/cannot find/i)
            ) {
                errors.push(trimmed);
            }
        }

        return errors;
    }

    /**
     * Quick syntax check for a single file.
     */
    async checkFile(filePath: string): Promise<VerificationResult> {
        const ext = path.extname(filePath).toLowerCase();
        const cwd = path.dirname(filePath);

        let command: string;
        switch (ext) {
            case '.ts':
            case '.tsx':
                command = `npx tsc --noEmit ${filePath}`;
                break;
            case '.py':
                command = `python -m py_compile ${filePath}`;
                break;
            case '.go':
                command = `go vet ${filePath}`;
                break;
            case '.rs':
                command = `cargo check`;
                break;
            default:
                return {
                    success: true,
                    output: `No checker available for ${ext} files.`,
                    errors: [],
                    command: 'none',
                };
        }

        return this.runCommand(command, cwd);
    }
}
