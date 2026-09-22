---
name: API client codegen DOM iterable requirement
description: The generated Orval client uses Headers.entries and needs the iterable DOM library enabled.
---

Generated API clients can call `Headers.entries()` even though they are shared libraries. Keep `dom.iterable` enabled in the generated client package's TypeScript library list.

**Why:** The generated client typechecks against the DOM types, and `dom` alone does not expose `Headers.entries()`.

**How to apply:** If API codegen starts failing on `Headers.entries`, check the client package's `tsconfig.json` before changing generated files.