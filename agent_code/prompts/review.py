"""Prompt template for the REVIEW action."""

REVIEW_PROMPT = """## Task
Review the following code for potential issues. ALWAYS respond in Vietnamese.

{project_context}

## Instructions
Analyze the code and report on:

1. **Bugs**: Logic errors, off-by-one errors, null/None issues
2. **Security**: SQL injection, XSS, hardcoded secrets, unsafe deserialization
3. **Performance**: N+1 queries, unnecessary loops, memory leaks
4. **Code Quality**: Code smells, duplicated logic, poor naming
5. **Best Practices**: Missing error handling, no input validation

## Output Format
For each issue found, use this format:
- **[SEVERITY]** `filename:line` — Description of the issue
  - Suggestion: How to fix it

Severity levels: 🔴 CRITICAL | 🟡 WARNING | 🔵 INFO

If no issues are found, say "Không tìm thấy vấn đề đáng kể."
Do NOT rewrite the code — only report issues.
IMPORTANT: Your entire response MUST be in Vietnamese (tiếng Việt).
"""
