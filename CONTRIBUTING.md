# Contributing to App2Reel

Useful contributions include reproducible bug reports, improvements to the first-run experience, clearer documentation, and focused changes to recording, editing, narration, or rendering.

## Get started

Follow the [installation guide](docs/installation.md), then read the [development guide](docs/development.md) for the code layout and local workflow. Try the included sample project before using a real product account.

For a bug, include the App2Reel version or commit, operating system, steps to reproduce, expected result, and actual result. Mention the voice engine and output settings when relevant. For a feature, explain the user goal and what is difficult today.

Security vulnerabilities use the reporting process in [SECURITY.md](SECURITY.md).

## Make a change

Keep pull requests small and focused on one problem. Discuss substantial changes in an issue so contributors can agree on the intended behavior and integration points. Follow the surrounding TypeScript and React conventions, and update documentation when setup or behavior changes.

Run the project checks before submitting a code change:

```bash
pnpm test
pnpm run build
```

Add a regression test when it demonstrates a meaningful failure your change fixes. Documentation-only changes need working links and accurate commands; explain which checks apply in the pull request.

For recording or rendering changes, also exercise the sample project through the affected workflow. Attach a short, sanitized video or representative frames from the actual export, with resolution, voice choice, and relevant settings. Describe what you inspected and any unverified platforms or limitations. Screenshots alone cannot demonstrate pointer timing, transitions, speech synchronization, or motion.

## Keep reports and contributions safe to share

Use fictional or disposable test data in examples. Remove passwords, tokens, cookies, account identifiers, personal information, and private product URLs from logs and screenshots. Raw captures, browser profiles, `.capture/`, downloaded voice models, and generated media from private accounts must stay out of commits and public reports. Privacy masks affect exported films; they do not remove sensitive data from source recordings or screenshots.

Summarize the problem, the resulting behavior, and the verification in your pull request. Link a related issue when one exists. Call out changes to browser boundaries, credential handling, data sent to AI, local storage, or dependency licenses so reviewers can assess them.

By contributing, you agree that your original contributions may be distributed under this repository's [MIT license](LICENSE). Preserve required upstream notices for third-party code and assets.
