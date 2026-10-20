---
name: refactor-safely
description: Refactors StitchVue without mixing features. Use for restructure/rename/split. Not for SpecKit specs/ or sealed TASK from docs/refactoring/tasks/ (use HANDOFF + executor).
---

# Refactor safely

Do not mix a feature and a refactor in one change.

Git: one checkout `ImageGrid`, ordinary branches only — `.cursor/rules/git-branch-workflow.mdc`. Do not create worktrees, clones, or extra project folders for isolation.

1. State the current behavior in one short paragraph. Cite the spec section.
2. Run the tests and typechecks that already exist. If they fail before the refactor, stop and report that.
3. Define the exact goal (move, rename, split). Anything else is out of scope.
4. Change only that scope. Keep the public command and UI behavior the same. New or changed comments — Russian only (`.cursor/rules/code-comments.mdc`).
5. Run the same checks again.
6. Compare `git diff` to the goal. Revert drive-by edits.

If a behavior change is required to make the refactor possible, stop and ask. Do not hide it inside the refactor.
