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
exports.TaskManager = void 0;
/**
 * Task Manager — state machine for tracking multi-step agent tasks.
 *
 * Manages the lifecycle of complex tasks:
 * PLANNING → AWAITING_APPROVAL → EXECUTING → VERIFYING → DONE/FAILED
 */
const vscode = __importStar(require("vscode"));
const crypto = __importStar(require("crypto"));
// ── Task Manager ─────────────────────────────────────────────────────
class TaskManager {
    constructor() {
        this.currentTask = null;
        this._onTaskEvent = new vscode.EventEmitter();
        this.onTaskEvent = this._onTaskEvent.event;
    }
    /**
     * Create a new task from a description (before planning).
     */
    createTask(description) {
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
    setPlan(plan) {
        if (!this.currentTask) {
            return;
        }
        this.currentTask.plan = plan;
        this.currentTask.title = plan.title;
        this.currentTask.steps = plan.steps.map((s) => ({
            ...s,
            status: 'pending',
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
    approvePlan() {
        if (!this.currentTask || this.currentTask.status !== 'awaiting_approval') {
            return;
        }
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
    rejectPlan() {
        if (!this.currentTask) {
            return;
        }
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
    startStep(index) {
        if (!this.currentTask || index >= this.currentTask.steps.length) {
            return;
        }
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
    completeStep(index, result) {
        if (!this.currentTask || index >= this.currentTask.steps.length) {
            return;
        }
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
    failStep(index, error) {
        if (!this.currentTask || index >= this.currentTask.steps.length) {
            return;
        }
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
    startVerification() {
        if (!this.currentTask) {
            return;
        }
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
    completeTask() {
        if (!this.currentTask) {
            return;
        }
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
    failTask(error) {
        if (!this.currentTask) {
            return;
        }
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
    getTask() {
        return this.currentTask;
    }
    /**
     * Check if there's an active (non-idle) task.
     */
    isActive() {
        return this.currentTask !== null && this.currentTask.status !== 'done' && this.currentTask.status !== 'failed';
    }
    /**
     * Get progress summary.
     */
    getProgress() {
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
    dispose() {
        this._onTaskEvent.dispose();
    }
}
exports.TaskManager = TaskManager;
//# sourceMappingURL=taskManager.js.map