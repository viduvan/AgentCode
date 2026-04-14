"""Agent Core — orchestrate prompt creation using templates and rules."""

from __future__ import annotations

from agent_code.prompts.base import SYSTEM_RULES, PROJECT_CONTEXT_TEMPLATE
from agent_code.prompts.edit import EDIT_PROMPT
from agent_code.prompts.explain import EXPLAIN_PROMPT
from agent_code.prompts.review import REVIEW_PROMPT
from agent_code.prompts.generate import GENERATE_PROMPT


class Agent:
    """Build structured prompts for different actions.

    The Agent selects the appropriate prompt template,
    injects project context, and returns a (system, user) prompt pair.
    """

    # Map action names to their prompt templates
    TEMPLATES: dict[str, str] = {
        "edit": EDIT_PROMPT,
        "explain": EXPLAIN_PROMPT,
        "review": REVIEW_PROMPT,
        "generate": GENERATE_PROMPT,
    }

    def create_prompt(
        self,
        action: str,
        instruction: str,
        *,
        context: str = "",
        tree: str = "",
    ) -> tuple[str, str]:
        """Create a (system_prompt, user_prompt) pair.

        Parameters
        ----------
        action : str
            One of "edit", "explain", "review", "generate".
        instruction : str
            The user's natural-language instruction.
        context : str
            Formatted source code context from ContextBuilder.
        tree : str
            Project directory tree from ProjectScanner.

        Returns
        -------
        tuple[str, str]
            (system_prompt, user_prompt)
        """
        template = self.TEMPLATES.get(action)
        if template is None:
            raise ValueError(
                f"Unknown action: {action!r}. "
                f"Supported: {', '.join(self.TEMPLATES)}"
            )

        # Build project context section
        project_context = ""
        if context or tree:
            project_context = PROJECT_CONTEXT_TEMPLATE.format(
                tree=tree or "(not available)",
                context=context or "(no source files)",
            )

        # Format the user prompt
        user_prompt = template.format(
            instruction=instruction,
            project_context=project_context,
        )

        return SYSTEM_RULES, user_prompt
