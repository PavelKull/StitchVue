---
name: bug-investigation
description: Investigates a StitchVue bug before editing. Use when fixing a defect, a regression, a wrong thumbnail, a scroll glitch, a cache miss, or any report that something fails.
---

# Bug investigation

Do not rewrite the feature because a bug exists.

```text
REPRODUCE → OBSERVE → LOCATE → HYPOTHESIS → VERIFY → FIX MINIMUM → TEST
```

1. Reproduce with the smallest folder, file, or step count. If you cannot reproduce, say what was tried and stop.
2. Record the actual behavior and the spec rule it breaks.
3. Search call sites. Read only the files on that path.
4. State one hypothesis.
5. Verify with a log, a test, a query, or a diff. Do not stack a second hypothesis on an unverified first.
6. Change the minimum code that makes the hypothesis true or false.
7. Run the existing typecheck and tests. Retest the original reproduction.

## Three-attempt stop

After three failed fixes of the same failure, stop and report:

```text
Observed:
Tried:
Result:
Hypothesis:
```

The third attempt must not widen into a refactor. Open a fresh investigation instead of more random edits.
