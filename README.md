<img src="extension/icons/icon-128.png" alt="" width="64" align="right">

# Gradescope to Canvas

A Chrome extension that copies a multiple-choice quiz from Gradescope into a Canvas quiz: the questions, the answer key, the points, the math and the figures.

<p align="center"><img src="docs/demo.gif" alt="Copying a quiz from Gradescope and importing it into Canvas" width="760"></p>

If you've ever rebuilt an exam in Canvas by hand, you know the drill. Retype every question, re-mark every answer, re-upload every figure, fix whatever the math turned into. This does it in about a minute, and it all happens in your own browser, so there's no server to run and no API token to create.

## Using it

1. On Gradescope, open the assignment's **rubric page** and click **Copy quiz for Canvas**. It's the dark tab on the right edge of the page. Tick the questions you want (a whole section at a time works too) and click **Copy**.
2. Want questions from another Gradescope quiz in the same Canvas quiz? Repeat step 1 on that quiz. Each one is added to what you've already copied.
3. In Canvas, open the target quiz's **Edit** page and click **Import from Gradescope**.
4. Look over the preview, untick anything you don't want, click **Import**, then reload the page.

The quiz title, settings and publishing are left to you.

## What comes across

- Multiple-choice and select-all questions, with the correct answers and point values.
- Math, as Canvas equations. Code that was typed as math (SQL, in the exam this was built on) becomes a proper code block.
- Figures, uploaded to a hidden folder in the course files so students can't browse them.
- Text shared by a whole section, like a scenario or a schema. Canvas has no shared-text block, so you choose whether to repeat it on each question. Short generic instructions are left off by default.

Before it copies anything it checks that every question has an answer key, that the points add up and that question numbers are unique. Anything it can't copy (free response, say) is listed as "Not copied" in the preview instead of quietly disappearing.

It never deletes anything. Questions already in the quiz are left alone unless you tick them to be replaced, and if the quiz had other questions, new ones are added at the end without reshuffling yours.

## Install

It isn't in the Chrome Web Store, so you load it yourself:

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick the `extension/` folder.

The extension is set up for `canvas.asu.edu` and `*.instructure.com`. If your school uses another Canvas address, add it to the Canvas entry under `content_scripts` in `extension/manifest.json`, then reload the extension.

## Privacy

Your quiz goes from the Gradescope tab to the Canvas tab through `chrome.storage` and nowhere else. The extension acts through the sessions you're already signed in to. Its only host permission is Gradescope, to download figures, because a web page can't read those itself.

## Good to know

- Canvas **classic** quizzes only, not New Quizzes.
- It has been tried on one real exam. Select-all questions are supported but only tested on made-up data, so expect some rough edges on other quizzes, and open an issue if you find one.

## Development

No dependencies. `node test/run.js` runs the tests: extraction rules, the importer, validation, the manifest and the UI text.

```
extension/lib/            the logic, with no Chrome APIs so it can be tested
extension/content/        the buttons and dialogs on each site
extension/background.js   downloads figures from Gradescope
```

The logo is `extension/icons/logo.svg`. The 16px icon has its own simplified drawing, `logo-16.svg`, because the full one blurs at that size.

## License

MIT, see [LICENSE](LICENSE). Not affiliated with or endorsed by Gradescope, Canvas, Instructure or Arizona State University. Contributions are welcome, see [CONTRIBUTING.md](CONTRIBUTING.md).
