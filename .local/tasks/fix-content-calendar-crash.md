## Fix: Content Calendar crash on empty body field

### What & Why
The Content Calendar page throws a runtime error — "undefined is not an object (evaluating 'text.length')" — whenever the content body field is empty or not yet filled in. The `getCharacterCount` function on line 467 of `client/src/pages/content-calendar.tsx` receives `undefined` and tries to call `.length` on it.

### Done looks like
- No runtime crash when opening the content creation dialog with an empty body
- Character counter shows 0 instead of crashing
- All other character counting behaviour unchanged

### Change required
**File:** `client/src/pages/content-calendar.tsx`, line 467

From:
```ts
const getCharacterCount = (text: string) => text.length;
```

To:
```ts
const getCharacterCount = (text: string | undefined) => (text ?? '').length;
```
