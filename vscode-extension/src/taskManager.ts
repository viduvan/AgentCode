/**
 * Task Manager — state machine for tracking multi-step agent tasks.
 *
 * Manages the lifecycle of complex tasks:
 * PLANNING → AWAITING_APPROVAL → EXECUTING → VERIFYING → DONE/FAILED
 */
import * as vscode from 'vscode';
import * as crypto from 'crypto';

// ── Types ────────────────────────────────────────────────────────────

export type TaskStatus = 'planning' | 'awaiting_approval' | 'executing' | 'verifying' | 'done' | 'failed' | 'cancelled';
export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';
export type StepType = 'edit' | 'generate' | 'shell';

export interface PlanStep {
    description: string;
    type: StepType;
    target: string;       // file path or shell command
    instruction: string;  // detailed LLM instruction
}

export interface TaskStep extends PlanStep {
    status: StepStatus;
    result?: string;
    error?: string;
}

export interface WorkflowPlan {
    title: string;
    steps: PlanStep[];
    verification: string[];
}

export interface TaskState {
    id: string;
    status: TaskStatus;
    title: string;
    description: string;
    steps: TaskStep[];
    currentStepIndex: number;
    plan: WorkflowPlan | null;
    createdAt: number;
    error?: string;
}

// ── Event Emitter ────────────────────────────────────────────────────

export interface TaskEvent {
    taskId: string;
    type: 'statusChange' | 'stepUpdate' | 'planReady' | 'completed' | 'failed';
    data?: any;
}

// ── Task Manager ─────────────────────────────────────────────────────

export class TaskManager {
    private currentTask: TaskState | null = null;
    private _onTaskEvent = new vscode.EventEmitter<TaskEvent>();
    readonly onTaskEvent = this._onTaskEvent.event;

    /**
     * Create a new task from a description (before planning).
     */
    createTask(description: string): TaskState {
        this.currentTask = {
            id: crypto.randomUUID(),
            status: 'planning',
            title: description.slice(0, 60),
            description,
            steps: [],
            currentStepIndex: -1,
            plan: null,
            createdAt: Date.now(),
        };

        this._onTaskEvent.fire({
            taskId: this.currentTask.id,
            type: 'statusChange',
            data: { status: 'planning' },
        });

        return this.currentTask;
    }

    /**
     * Set the plan and move to awaiting approval.
     */
    setPlan(plan: WorkflowPlan): void {
        if (!this.currentTask) { return; }

        this.currentTask.plan = plan;
        this.currentTask.title = plan.title;
        this.currentTask.steps = plan.steps.map((s) => ({
            ...s,
            status: 'pending' as StepStatus,
        }));
        this.currentTask.status = 'awaiting_approval';

        this._onTaskEvent.fire({
            taskId: this.currentTask.id,
            type: 'planReady',
            data: { plan },
        });
    }

    /**
     * Approve the plan → start executing.
     */
    approvePlan(): void {
        if (!this.currentTask || this.currentTask.status !== 'awaiting_approval') { return; }
        this.currentTask.status = 'executing';
        this.currentTask.currentStepIndex = 0;

        this._onTaskEvent.fire({
            taskId: this.currentTask.id,
            type: 'statusChange',
            data: { status: 'executing' },
        });
    }

    /**
     * Reject the plan → cancel task.
     */
    rejectPlan(): void {
        if (!this.currentTask) { return; }
        this.currentTask.status = 'cancelled';

        this._onTaskEvent.fire({
            taskId: this.currentTask.id,
            type: 'statusChange',
            data: { status: 'cancelled' },
        });

        this.currentTask = null;
    }

    /**
     * Mark the current step as running.
     */
    startStep(index: number): void {
        if (!this.currentTask || index >= this.currentTask.steps.length) { return; }
        this.currentTask.steps[index].status = 'running';
        this.currentTask.currentStepIndex = index;

        this._onTaskEvent.fire({
            taskId: this.currentTask.id,
            type: 'stepUpdate',
            data: { index, status: 'running', step: this.currentTask.steps[index] },
        });
    }

    /**
     * Mark a step as completed.
     */
    completeStep(index: number, result?: string): void {
        if (!this.currentTask || index >= this.currentTask.steps.length) { return; }
        this.currentTask.steps[index].status = 'done';
        this.currentTask.steps[index].result = result;

        this._onTaskEvent.fire({
            taskId: this.currentTask.id,
            type: 'stepUpdate',
            data: { index, status: 'done', step: this.currentTask.steps[index] },
        });
    }

    /**
     * Mark a step as failed.
     */
    failStep(index: number, error: string): void {
        if (!this.currentTask || index >= this.currentTask.steps.length) { return; }
        this.currentTask.steps[index].status = 'failed';
        this.currentTask.steps[index].error = error;

        this._onTaskEvent.fire({
            taskId: this.currentTask.id,
            type: 'stepUpdate',
            data: { index, status: 'failed', error },
        });
    }

    /**
     * Move to verification phase.
     */
    startVerification(): void {
        if (!this.currentTask) { return; }
        this.currentTask.status = 'verifying';

        this._onTaskEvent.fire({
            taskId: this.currentTask.id,
            type: 'statusChange',
            data: { status: 'verifying' },
        });
    }

    /**
     * Mark entire task as done.
     */
    completeTask(): void {
        if (!this.currentTask) { return; }
        this.currentTask.status = 'done';

        this._onTaskEvent.fire({
            taskId: this.currentTask.id,
            type: 'completed',
        });

        this.currentTask = null;
    }

    /**
     * Mark entire task as failed.
     */
    failTask(error: string): void {
        if (!this.currentTask) { return; }
        this.currentTask.status = 'failed';
        this.currentTask.error = error;

        this._onTaskEvent.fire({
            taskId: this.currentTask.id,
            type: 'failed',
            data: { error },
        });

        this.currentTask = null;
    }

    /**
     * Get current task state.
     */
    getTask(): TaskState | null {
        return this.currentTask;
    }

    /**
     * Check if there's an active (non-idle) task.
     */
    isActive(): boolean {
        return this.currentTask !== null && this.currentTask.status !== 'done' && this.currentTask.status !== 'failed';
    }

    /**
     * Get progress summary.
     */
    getProgress(): { done: number; total: number; current: string } {
        if (!this.currentTask) {
            return { done: 0, total: 0, current: '' };
        }
        const done = this.currentTask.steps.filter(s => s.status === 'done').length;
        const total = this.currentTask.steps.length;
        const current = this.currentTask.currentStepIndex >= 0 && this.currentTask.currentStepIndex < total
            ? this.currentTask.steps[this.currentTask.currentStepIndex].description
            : '';
        return { done, total, current };
    }

    dispose(): void {
        this._onTaskEvent.dispose();
    }
}
