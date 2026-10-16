---
name: refactor-safely
description: Refactors StitchVue code without mixing in features. Use when the user asks to restructure, rename, split a module, or clean up an existing path.
---

# Refactor safely

Do not mix a feature and a refactor in one change.

1. State the current behavior in one short paragraph. Cite the spec section.
2. Run the tests and typechecks that already exist. If they fail before the refactor, stop and report that.
3. Define the exact goal (move, rename, split). Anything else is out of scope.
4. Change only that scope. Keep the public command and UI behavior the same.
5. Run the same checks again.
6. Compare `git diff` to the goal. Revert drive-by edits.

If a behavior change is required to make the refactor possible, stop and ask. Do not hide it inside the refactor.
