"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntentRouter = void 0;
const prompts_1 = require("./prompts");
/**
 * Default fallback if LLM classification fails.
 */
function fallbackIntent(userMessage) {
    return {
        intent: 'chat',
        confidence: 0.5,
        targetFile: null,
        instruction: userMessage,
        complexity: 'simple',
    };
}
class IntentRouter {
    constructor(ollama) {
        this.ollama = ollama;
    }
    /**
     * Classify a user message into an intent.
     *
     * @param userMessage The raw user message
     * @param activeFile Currently open file path (if any)
     * @param hasSelection Whether the user has code selected
     */
    async classify(userMessage, activeFile, hasSelection) {
        const prompt = (0, prompts_1.buildIntentPrompt)(userMessage, activeFile, hasSelection);
        try {
            const raw = await this.ollama.generateSimple(prompt, prompts_1.INTENT_SYSTEM);
            return this.parseResponse(raw, userMessage);
        }
        catch (err) {
            console.error('[IntentRouter] Classification failed:', err);
            return fallbackIntent(userMessage);
        }
    }
    /**
     * Parse the LLM JSON response into a typed IntentResult.
     */
    parseResponse(raw, originalMessage) {
        try {
            // Try to extract JSON from the response (LLM may add extra text)
            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                console.warn('[IntentRouter] No JSON found in response:', raw);
                return fallbackIntent(originalMessage);
            }
            const parsed = JSON.parse(jsonMatch[0]);
            // Validate required fields
            const validIntents = ['chat', 'explain', 'edit', 'generate', 'review', 'plan'];
            const intent = validIntents.includes(parsed.intent) ? parsed.intent : 'chat';
            return {
                intent,
                confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
                targetFile: parsed.targetFile || null,
                instruction: parsed.instruction || originalMessage,
                complexity: parsed.complexity === 'complex' ? 'complex' : 'simple',
            };
        }
        catch (err) {
            console.warn('[IntentRouter] Failed to parse JSON:', err, raw);
            return fallbackIntent(originalMessage);
        }
    }
}
exports.IntentRouter = IntentRouter;
//# sourceMappingURL=intentRouter.js.map