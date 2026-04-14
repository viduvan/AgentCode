"""Prompt template for the GENERATE action."""

GENERATE_PROMPT = """## Task
Generate new code based on this description:
**"{instruction}"**

{project_context}

## Instructions
1. Create complete, working code files
2. Follow best practices for the relevant language/framework
3. Include proper imports and dependencies
4. Add docstrings and comments where appropriate
5. Return EACH file inside a fenced code block with the filename:
   ```path/to/newfile.py
   # complete file content here
   ```
6. If the project context is provided, make sure new code integrates with existing code style
7. Include any necessary configuration files (requirements, etc.)
"""
