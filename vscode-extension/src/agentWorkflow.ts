/**
 * Agent Workflow — main orchestrator for the conversational AI agent.
 *
 * Routes user messages through intent detection, then executes
 * the appropriate action (chat, edit, generate, explain, review, plan).
 *
 * For complex tasks, manages the full plan → approve → execute → verify cycle.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

import { OllamaClient } from './ollama';
import { DiffManager } from './diffManager';
import { ContextBuilder } from './contextBuilder';
import { IntentRouter, IntentResult } from './intentRouter';
import { TaskManager, WorkflowPlan, PlanStep } from './taskManager';
import { Verifier } from './verifier';
import * as Prompts from './prompts';

// ── Callback interface for UI updates ────────────────────────────────

export interface WorkflowCallbacks {
    /** Send a chat-style message to the user. */
    sendMessage(role: 'assistant' | 'error', text: string): void;
    /** Stream tokens for live typing effect. */
    streamToken(text: string): void;
    /** Show/hide thinking indicator. */
    setThinking(show: boolean, label?: string): void;
    /** Show a plan preview for approval. */
    showPlan(plan: WorkflowPlan): void;
    /** Update task progress (step N of M). */
    updateProgress(stepIndex: number, total: number, description: string, status: string): void;
    /** Show final result badge. */
    showResult(success: boolean, message: string): void;
}

// ── Agent Workflow ───────────────────────────────────────────────────

export class AgentWorkflow {
    private intentRouter: IntentRouter;
    private taskManager: TaskManager;
    private verifier: Verifier;
    private callbacks: WorkflowCallbacks | null = null;
    private pendingApprovalResolve: ((approved: boolean) => void) | null = null;

    constructor(
        private ollama: OllamaClient,
        private diffManager: DiffManager,
    ) {
        this.intentRouter = new IntentRouter(ollama);
        this.taskManager = new TaskManager();
        this.verifier = new Verifier();
    }

    /** Set the UI callbacks (from ChatPanelProvider). */
    setCallbacks(callbacks: WorkflowCallbacks): void {
        this.callbacks = callbacks;
    }

    // ── Main Entry Point ─────────────────────────────────────────────

    /**
     * Handle a user message — the single entry point for all interactions.
     */
    async handleMessage(text: string): Promise<void> {
        if (!this.callbacks) {
            console.error('[AgentWorkflow] No callbacks set');
            return;
        }

        const editor = vscode.window.activeTextEditor;
        const activeFile = editor?.document.fileName;
        const hasSelection = editor ? !editor.selection.isEmpty : false;

        // ── Step 1: Classify intent ──
        this.callbacks.setThinking(true, '🔍 Đang phân tích...');

        let intent: IntentResult;
        try {
            intent = await this.intentRouter.classify(text, activeFile, hasSelection);
            console.log('[AgentWorkflow] Intent:', JSON.stringify(intent));
        } catch (err: any) {
            this.callbacks.setThinking(false);
            this.callbacks.sendMessage('error', `Lỗi phân tích: ${err.message}`);
            return;
        }

        // ── Step 2: Route to handler ──
        try {
            switch (intent.intent) {
                case 'chat':
                    await this.executeChat(intent);
                    break;
                case 'explain':
                    await this.executeExplain(intent);
                    break;
                case 'edit':
                    await this.executeEdit(intent);
                    break;
                case 'generate':
                    await this.executeGenerate(intent);
                    break;
                case 'review':
                    await this.executeReview(intent);
                    break;
                case 'plan':
                    await this.executePlan(intent);
                    break;
                default:
                    await this.executeChat(intent);
            }
        } catch (err: any) {
            this.callbacks.setThinking(false);
            this.callbacks.sendMessage('error', `Lỗi: ${err.message}`);
        }
    }

    // ── Chat (simple Q&A) ────────────────────────────────────────────

    private async executeChat(intent: IntentResult): Promise<void> {
        this.callbacks!.setThinking(true, '💬 Đang trả lời...');

        const collected: string[] = [];
        await this.ollama.generate({
            prompt: intent.instruction,
            system: Prompts.CHAT_SYSTEM,
            onToken: (token) => {
                collected.push(token);
                if (collected.length % 3 === 0) {
                    this.callbacks!.streamToken(collected.join(''));
                }
            },
        });

        const fullText = collected.join('');
        this.callbacks!.sendMessage('assistant', fullText);
        this.callbacks!.setThinking(false);
    }

    // ── Explain ──────────────────────────────────────────────────────

    private async executeExplain(intent: IntentResult): Promise<void> {
        this.callbacks!.setThinking(true, '📖 Đang đọc và phân tích code...');

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            this.callbacks!.setThinking(false);
            this.callbacks!.sendMessage('assistant', '⚠️ Không có file nào đang mở. Hãy mở file cần giải thích.');
            return;
        }

        const code = editor.selection.isEmpty
            ? ContextBuilder.fromDocument(editor.document)
            : ContextBuilder.fromSelection(editor);
        const lang = editor.document.languageId;

        const prompt = Prompts.buildExplainPrompt(code, lang, intent.instruction);

        const collected: string[] = [];
        await this.ollama.generate({
            prompt,
            system: Prompts.EXPLAIN_SYSTEM,
            onToken: (token) => {
                collected.push(token);
                if (collected.length % 3 === 0) {
                    this.callbacks!.streamToken(collected.join(''));
                }
            },
        });

        const fullText = collected.join('');
        this.callbacks!.sendMessage('assistant', fullText);
        this.callbacks!.setThinking(false);
    }

    // ── Edit ─────────────────────────────────────────────────────────

    private async executeEdit(intent: IntentResult): Promise<void> {
        this.callbacks!.setThinking(true, '📝 Đang chỉnh sửa code...');

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            this.callbacks!.setThinking(false);
            this.callbacks!.sendMessage('assistant', '⚠️ Không có file nào đang mở. Hãy mở file cần sửa.');
            return;
        }

        const selection = editor.selection;
        const selectedCode = selection.isEmpty
            ? editor.document.getText()
            : editor.document.getText(selection);
        const range = selection.isEmpty
            ? new vscode.Range(
                editor.document.positionAt(0),
                editor.document.positionAt(editor.document.getText().length),
            )
            : selection;

        const fileName = editor.document.fileName;
        const lang = editor.document.languageId;
        const prompt = Prompts.buildEditPrompt(selectedCode, intent.instruction, fileName, lang);

        let result: string;
        try {
            result = await this.ollama.generate({
                prompt,
                system: Prompts.EDIT_SYSTEM,
            });
        } catch (err: any) {
            this.callbacks!.setThinking(false);
            this.callbacks!.sendMessage('error', `LLM Error: ${err.message}`);
            return;
        }

        // Clean response
        const cleaned = this.cleanCodeResponse(result, lang);

        this.callbacks!.setThinking(false);
        this.callbacks!.sendMessage('assistant', `✏️ Đã tạo bản sửa cho **${path.basename(fileName)}**. Xem diff và Accept/Reject.`);

        // Show diff
        await this.diffManager.showDiff(editor.document.uri, selectedCode, cleaned, range);
    }

    // ── Generate ─────────────────────────────────────────────────────

    private async executeGenerate(intent: IntentResult): Promise<void> {
        this.callbacks!.setThinking(true, '🔨 Đang tạo code...');

        const editor = vscode.window.activeTextEditor;
        let context = '';
        if (editor && !editor.selection.isEmpty) {
            context = ContextBuilder.fromSelection(editor);
        }

        const prompt = Prompts.buildGeneratePrompt(intent.instruction, context || undefined);

        const collected: string[] = [];
        await this.ollama.generate({
            prompt,
            system: Prompts.GENERATE_SYSTEM,
            onToken: (token) => {
                collected.push(token);
                if (collected.length % 3 === 0) {
                    this.callbacks!.streamToken(collected.join(''));
                }
            },
        });

        const fullText = collected.join('');
        const { code, language } = this.extractCodeBlock(fullText);

        if (code.trim()) {
            const fileName = this.inferFileName(intent.instruction, language);
            this.callbacks!.sendMessage('assistant', fullText);
            this.callbacks!.setThinking(false);
            await this.diffManager.showNewFilePreview(code, fileName, language);
        } else {
            this.callbacks!.sendMessage('assistant', fullText);
            this.callbacks!.setThinking(false);
        }
    }

    // ── Review ───────────────────────────────────────────────────────

    private async executeReview(intent: IntentResult): Promise<void> {
        this.callbacks!.setThinking(true, '🔎 Đang review code...');

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            this.callbacks!.setThinking(false);
            this.callbacks!.sendMessage('assistant', '⚠️ Không có file nào đang mở. Hãy mở file cần review.');
            return;
        }

        const code = ContextBuilder.fromDocument(editor.document);
        const lang = editor.document.languageId;
        const prompt = Prompts.buildReviewPrompt(code, lang, intent.instruction);

        const collected: string[] = [];
        await this.ollama.generate({
            prompt,
            system: Prompts.REVIEW_SYSTEM,
            onToken: (token) => {
                collected.push(token);
                if (collected.length % 3 === 0) {
                    this.callbacks!.streamToken(collected.join(''));
                }
            },
        });

        const fullText = collected.join('');
        this.callbacks!.sendMessage('assistant', fullText);
        this.callbacks!.setThinking(false);
    }

    // ── Plan (Multi-step) ────────────────────────────────────────────

    private async executePlan(intent: IntentResult): Promise<void> {
        this.callbacks!.setThinking(true, '🧠 Đang lập kế hoạch...');

        // 1. Get project tree
        const projectTree = await ContextBuilder.getProjectTree();

        // 2. Get some context from active file
        const editor = vscode.window.activeTextEditor;
        let context = '';
        if (editor) {
            context = ContextBuilder.fromDocument(editor.document);
        }

        // 3. Ask LLM to create a plan
        const prompt = Prompts.buildPlanPrompt(intent.instruction, projectTree, context || undefined);

        let rawPlan: string;
        try {
            rawPlan = await this.ollama.generateSimple(prompt, Prompts.PLAN_SYSTEM);
        } catch (err: any) {
            this.callbacks!.setThinking(false);
            this.callbacks!.sendMessage('error', `Lỗi lập kế hoạch: ${err.message}`);
            return;
        }

        // 4. Parse plan JSON
        const plan = this.parsePlan(rawPlan);
        if (!plan) {
            this.callbacks!.setThinking(false);
            this.callbacks!.sendMessage('error', '❌ Không thể tạo kế hoạch. Thử mô tả chi tiết hơn.');
            return;
        }

        // 5. Create task & show plan
        this.taskManager.createTask(intent.instruction);
        this.taskManager.setPlan(plan);

        this.callbacks!.setThinking(false);
        this.callbacks!.showPlan(plan);

        // 6. Wait for user approval
        const approved = await this.waitForApproval();

        if (!approved) {
            this.taskManager.rejectPlan();
            this.callbacks!.sendMessage('assistant', '🚫 Kế hoạch đã bị hủy.');
            return;
        }

        // 7. Execute plan
        this.taskManager.approvePlan();
        await this.executePlanSteps(plan);
    }

    /**
     * Wait for user to approve or reject the plan.
     */
    private waitForApproval(): Promise<boolean> {
        return new Promise((resolve) => {
            this.pendingApprovalResolve = resolve;
        });
    }

    /** Called by ChatPanel when user clicks Approve. */
    approvePlan(): void {
        if (this.pendingApprovalResolve) {
            this.pendingApprovalResolve(true);
            this.pendingApprovalResolve = null;
        }
    }

    /** Called by ChatPanel when user clicks Reject. */
    rejectPlan(): void {
        if (this.pendingApprovalResolve) {
            this.pendingApprovalResolve(false);
            this.pendingApprovalResolve = null;
        }
    }

    /**
     * Execute all steps in the plan sequentially.
     */
    private async executePlanSteps(plan: WorkflowPlan): Promise<void> {
        const total = plan.steps.length;

        for (let i = 0; i < total; i++) {
            const step = plan.steps[i];
            this.taskManager.startStep(i);
            this.callbacks!.updateProgress(i, total, step.description, 'running');

            try {
                await this.executeStep(step);
                this.taskManager.completeStep(i);
                this.callbacks!.updateProgress(i, total, step.description, 'done');
            } catch (err: any) {
                this.taskManager.failStep(i, err.message);
                this.callbacks!.updateProgress(i, total, step.description, 'failed');
                this.callbacks!.sendMessage('error', `❌ Bước ${i + 1} thất bại: ${err.message}`);
                this.taskManager.failTask(err.message);
                return;
            }
        }

        // Verification phase
        this.taskManager.startVerification();
        this.callbacks!.setThinking(true, '✅ Đang kiểm tra kết quả...');

        const results = await this.verifier.verify(plan.verification);
        const allPassed = results.every(r => r.success);

        this.callbacks!.setThinking(false);

        if (allPassed) {
            this.taskManager.completeTask();
            this.callbacks!.showResult(true, `✅ Hoàn thành! ${total} bước đã thực hiện thành công.`);
        } else {
            const errors = results.filter(r => !r.success).map(r => r.errors.join('\n')).join('\n');
            this.callbacks!.showResult(false, `⚠️ Hoàn thành ${total} bước nhưng có lỗi build:\n${errors}`);
            this.taskManager.completeTask(); // Still mark as done, errors are informational
        }
    }

    /**
     * Execute a single plan step.
     */
    private async executeStep(step: PlanStep): Promise<void> {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

        if (step.type === 'generate') {
            // Generate a new file
            const result = await this.ollama.generate({
                prompt: step.instruction,
                system: Prompts.STEP_GENERATE_SYSTEM,
            });

            const { code, language } = this.extractCodeBlock(result);
            if (!code.trim()) {
                throw new Error('LLM không trả về code nào.');
            }

            // Write file directly to workspace
            const filePath = workspaceRoot
                ? path.join(workspaceRoot, step.target)
                : step.target;

            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(filePath, code, 'utf-8');

        } else if (step.type === 'edit') {
            // Edit an existing file
            const filePath = workspaceRoot
                ? path.join(workspaceRoot, step.target)
                : step.target;

            if (!fs.existsSync(filePath)) {
                throw new Error(`File không tồn tại: ${step.target}`);
            }

            const originalContent = fs.readFileSync(filePath, 'utf-8');
            const lang = path.extname(filePath).slice(1);

            const prompt = Prompts.buildEditPrompt(
                originalContent,
                step.instruction,
                filePath,
                lang,
            );

            const result = await this.ollama.generate({
                prompt,
                system: Prompts.STEP_EDIT_SYSTEM,
            });

            const cleaned = this.cleanCodeResponse(result, lang);
            fs.writeFileSync(filePath, cleaned, 'utf-8');

        } else if (step.type === 'shell') {
            // Run a shell command
            const { exec } = require('child_process');
            await new Promise<void>((resolve, reject) => {
                exec(step.target, { cwd: workspaceRoot, timeout: 30_000 }, (error: any) => {
                    if (error) {
                        reject(new Error(`Command failed: ${step.target}\n${error.message}`));
                    } else {
                        resolve();
                    }
                });
            });
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────

    private cleanCodeResponse(response: string, lang: string): string {
        let cleaned = response.trim();
        const fenceRegex = /^```(?:\w+)?\n([\s\S]*?)```$/;
        const match = cleaned.match(fenceRegex);
        if (match) {
            cleaned = match[1];
        }
        cleaned = cleaned.replace(/^\n+/, '').replace(/\n+$/, '');
        return cleaned;
    }

    private extractCodeBlock(text: string): { code: string; language: string } {
        const fenceRegex = /```(\w*)\n([\s\S]*?)```/;
        const match = text.match(fenceRegex);
        if (match) {
            return { code: match[2].replace(/\n$/, ''), language: match[1] || '' };
        }
        return { code: text.trim(), language: '' };
    }

    private inferFileName(description: string, language: string): string {
        const extMap: Record<string, string> = {
            python: '.py', javascript: '.js', typescript: '.ts', java: '.java',
            go: '.go', rust: '.rs', html: '.html', css: '.css',
            cpp: '.cpp', c: '.c', ruby: '.rb', php: '.php',
            swift: '.swift', kotlin: '.kt', shell: '.sh', bash: '.sh',
            sql: '.sql', json: '.json', yaml: '.yaml', xml: '.xml',
        };

        const ext = extMap[language.toLowerCase()] || '.txt';

        const cleaned = description
            .toLowerCase()
            .replace(/tạo|tao|viết|viet|hàm|ham|lớp|lop|class|function|func|file|code|bằng|bang|sử dụng|su dung|với|voi|cho|và|va|một|mot|cái|cai|các|cac/gi, '')
            .replace(/python|javascript|typescript|java|go|rust|html|css|c\+\+|ruby|php/gi, '')
            .trim()
            .replace(/[^a-z0-9\s]/g, '')
            .replace(/\s+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 30);

        return (cleaned || 'generated_code') + ext;
    }

    private parsePlan(raw: string): WorkflowPlan | null {
        try {
            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            if (!jsonMatch) { return null; }

            const parsed = JSON.parse(jsonMatch[0]);

            if (!parsed.title || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
                return null;
            }

            return {
                title: parsed.title,
                steps: parsed.steps.map((s: any) => ({
                    description: s.description || 'Step',
                    type: ['edit', 'generate', 'shell'].includes(s.type) ? s.type : 'generate',
                    target: s.target || '',
                    instruction: s.instruction || s.description || '',
                })),
                verification: Array.isArray(parsed.verification) ? parsed.verification : [],
            };
        } catch (err) {
            console.error('[AgentWorkflow] Failed to parse plan:', err);
            return null;
        }
    }

    dispose(): void {
        this.taskManager.dispose();
    }
}
