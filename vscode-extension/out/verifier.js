"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.Verifier = void 0;
/**
 * Verifier — auto-checks code after changes are applied.
 *
 * Detects project type and runs appropriate build/lint commands.
 */
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
class Verifier {
    /**
     * Run verification commands for the current workspace.
     * Returns results for each verification command.
     */
    async verify(commands) {
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
        const results = [];
        for (const cmd of cmds) {
            const result = await this.runCommand(cmd, workspaceRoot);
            results.push(result);
        }
        return results;
    }
    /**
     * Detect appropriate verification commands based on project files.
     */
    detectVerificationCommands(root) {
        const commands = [];
        // TypeScript / Node.js project
        if (fs.existsSync(path.join(root, 'tsconfig.json'))) {
            if (fs.existsSync(path.join(root, 'package.json'))) {
                try {
                    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
                    if (pkg.scripts?.compile) {
                        commands.push('npm run compile');
                    }
                    else if (pkg.scripts?.build) {
                        commands.push('npm run build');
                    }
                    else {
                        commands.push('npx tsc --noEmit');
                    }
                }
                catch {
                    commands.push('npx tsc --noEmit');
                }
            }
            else {
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
            }
            catch {
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
    runCommand(command, cwd) {
        return new Promise((resolve) => {
            (0, child_process_1.exec)(command, { cwd, timeout: 60_000 }, (error, stdout, stderr) => {
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
    parseErrors(output) {
        const errors = [];
        const lines = output.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            // Common error patterns
            if (trimmed.match(/error\s*(TS\d+)?:/i) ||
                trimmed.match(/Error:/i) ||
                trimmed.match(/SyntaxError/i) ||
                trimmed.match(/TypeError/i) ||
                trimmed.match(/cannot find/i)) {
                errors.push(trimmed);
            }
        }
        return errors;
    }
    /**
     * Quick syntax check for a single file.
     */
    async checkFile(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        const cwd = path.dirname(filePath);
        let command;
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
exports.Verifier = Verifier;
//# sourceMappingURL=verifier.js.map