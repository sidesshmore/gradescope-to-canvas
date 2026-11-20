# Contributing

Thanks for helping. Bug reports and small fixes are both welcome.

## Running the tests

No dependencies, just Node 18 or newer:

```
node test/run.js
```

To try the extension itself, load the `extension/` folder from `chrome://extensions` with Developer mode on (see the README).

## Where things live

- `extension/lib/` holds the logic and uses no Chrome APIs, so it can be tested in Node. Put new behaviour here when you can.
- `extension/content/` is only the buttons and dialogs.
- `test/run.js` has the tests. Add one with any behaviour change.

## Test data

Please don't commit real exams or answer keys. Tests use small made-up quizzes; copy the `good` quiz in `test/run.js` and change it. Real exports go in `fixtures/`, which is git-ignored.

## Ideas that would help

- Support for Canvas New Quizzes
- More question types (true/false, short answer)
- Making the Canvas address configurable without editing the manifest

For anything bigger than a small fix, open an issue first so we can agree on the approach.
