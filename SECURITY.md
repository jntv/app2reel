# Security policy

App2Reel runs locally for a single user and binds to `127.0.0.1`. It has no multi-user server authentication. Keep the studio on your own machine and use disposable product test accounts when exploring an unfamiliar application.

## Report a vulnerability

If this repository has GitHub private vulnerability reporting enabled, open its **Security** tab and choose **Report a vulnerability**. Use that private report to describe the affected version or commit, impact, reproduction steps, and a minimal example with fictional data.

If that option is unavailable, open an issue that only asks for a private security reporting channel. Do not include vulnerability details, credentials, tokens, cookies, personal data, or private recordings in a public issue or pull request. Wait for a private channel before sharing the report.

This file does not imply that private reporting is enabled or promise a response or remediation deadline. Security fixes are developed against the current development version; there is no published maintenance schedule for older versions.

## Relevant boundaries

- AI-assisted exploration sends the brief, screenshots, and visible page text to OpenAI through the installed Codex CLI. Local recording and rendering do not make those AI inputs private to your machine.
- Browser navigation and read-only request policies reduce accidental actions, but are not a complete security boundary against a hostile product.
- Original recordings and screenshots may contain private account data. Export masks do not alter those original files.
- Codex manages its own login. Product credentials, session material, and ignored project data should never be committed or attached to public reports.

See the [README](README.md) for current behavior and limitations.
