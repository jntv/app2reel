# GitHub launch

The public repository is **[jntv/app2reel](https://github.com/jntv/app2reel)**. Update links and package metadata first if you choose another owner.

## Repository presentation

- Name: `app2reel`
- Description: `Turn a product URL and brief into a narrated demo and animated launch film. Local rendering, your Codex subscription, MIT licensed.`
- Topics: the 11 entries in [topics.json](../.github/topics.json). GitHub calls discovery tags **topics**; release tags such as `v0.1.0` are separate.
- Social preview: [social-preview.png](../assets/readme/social-preview.png), 1280 × 640 pixels. Upload it under **Settings → General → Social preview**.
- README: lead with the result, screenshot, real setup commands, and sample project. Add a short actual output video after verifying it is safe to publish. The banner illustrates the workflow; it is not a rendered output example.
- Enable issues and private vulnerability reporting. Enable Discussions when you are ready to support community conversations.
- Keep raw recordings, credentials, local model downloads, and `node_modules/` out of Git. `.capture/` and `.env` are ignored.

## Before publishing

1. Run the commands in [development.md](development.md), including the complete tests and build. Run `pnpm run doctor` and try the fictional sample from a fresh installation.
2. Review `git status --short`, `git diff`, and `git ls-files` for local paths, credentials, generated media, and unintended files. Review Git history as well; ignoring a file does not remove earlier commits.
3. Review the [privacy guide](privacy.md), [upstream licenses](voices.md#dependency-licenses), and [voice-reference provenance](../assets/voices/README.md).
4. Commit the reviewed source and launch files. Commit the pnpm lockfile.
5. Choose the account and visibility deliberately before executing the publication commands below.

## Publish source and configure the remote

The repository and `origin` remote have already been created. Publish only reviewed, committed source. On the first push, preserve the initial GitHub license commit by merging `origin/main` into the local history before pushing; do not force-push over it.

```bash
git push -u origin HEAD:main
gh repo edit jntv/app2reel --default-branch main --enable-issues
gh api --method PUT repos/jntv/app2reel/topics --input .github/topics.json
```

The current working branch can have any name; `HEAD:main` publishes its committed contents to the remote `main` branch. Repository description and topics are already configured. If you fork or transfer the project, update the owner in README badges, package metadata, these commands, and the stats script's local default. The stats workflow itself follows `GITHUB_REPOSITORY`.

After the push, inspect **Actions → CI** before announcing the repo. Configure branch protection or a ruleset requiring the **CI** checks once their names appear. Upload the social preview and enable private vulnerability reporting through the repository settings. The **Repository stats** workflow can be run manually after publishing.

## Releases and tags

Version `0.1.0` is prepared in `package.json`; it is not a published release. Keep [CHANGELOG.md](../CHANGELOG.md) accurate, finish validation, and then create an annotated release tag:

```bash
git tag -a v0.1.0 -m "App2Reel 0.1.0"
git push origin v0.1.0
gh release create v0.1.0 --repo jntv/app2reel \
  --title "App2Reel v0.1.0" --generate-notes --prerelease
```

Start with a prerelease while fresh-machine installation is being validated. Do not move a published tag to another commit. Follow semantic versioning: patch for fixes, minor for backward-compatible features, major for breaking changes. Version 0.x can evolve quickly; document migrations and compatibility changes explicitly.

## Stars and launch feedback

The README's Shields badge reads the public repository's current star count. It will become useful after the repo exists and may be cached. Stars can decrease and do not measure successful installations.

`pnpm run stats` (or `npm run stats`) fetches current stars, forks, watchers, and combined open issues/pull requests from GitHub's repository metadata endpoint. It does not collect stargazer identities. It defaults to `jntv/app2reel`; pass `owner/repo` to inspect a different repository. Supply `GH_TOKEN` or `GITHUB_TOKEN` through your environment when necessary, never in a committed file.

The [Repository stats workflow](../.github/workflows/repo-stats.yml) records a daily snapshot at approximately **02:17 UTC / 07:47 IST** and supports manual runs. GitHub may delay schedules, and scheduled workflows run from the default branch. Each run writes counts to the Actions summary and uploads JSON retained for **90 days**. Download and archive artifacts for longer history. It uses read-only repository permissions and makes no automated commits or notifications. It does not reconstruct history from before the first run. Fork schedules may need enabling in Actions.

For a more useful launch scorecard, record successful first runs, time to the first export, reproducible bugs, and examples people share. Ask for consent before publishing somebody else's films or account screenshots. There is no installation telemetry in this launch setup.

## Launch assets still to record

- One 15–30 second clip: finished output first, URL and brief, browser exploration, then both exported films.
- Three reproducible examples from products you own or have permission to demonstrate. Include the exact brief, settings, machine, runtime, and exported result.
- One post explaining the problem, the actual output, setup requirements, and repository link. Adapt it for the community where you post.

Use real timings and outputs. Publish follow-up examples and fixes as you learn from users.

## References

- [GitHub repository topics](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics)
- [GitHub social previews](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview)
- [Repository metadata API](https://docs.github.com/en/rest/repos/repos#get-a-repository)
- [GitHub starring API and access restrictions](https://docs.github.com/en/rest/activity/starring)
- [Shields star badge](https://shields.io/badges/git-hub-repo-stars)
