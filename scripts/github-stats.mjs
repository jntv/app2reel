#!/usr/bin/env node
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function repositoryName(value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(value || '')) {
    throw new Error('Use a repository name in owner/repo format.');
  }
  return value;
}

export async function collectStats(repository, { token, fetchImpl = fetch, now = new Date() } = {}) {
  repositoryName(repository);
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'app2reel-repo-stats' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetchImpl(`https://api.github.com/repos/${repository}`, {
    headers,
    signal: AbortSignal.timeout(20_000),
    redirect: 'error',
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error(`Repository ${repository} is unavailable. Publish it first, or authenticate for a private repository.`);
    throw new Error(`GitHub returned HTTP ${response.status}. Check repository access and API rate limits.`);
  }
  const data = await response.json();
  const counts = { stars: data.stargazers_count, forks: data.forks_count, openIssuesAndPullRequests: data.open_issues_count, watchers: data.subscribers_count };
  for (const [key, value] of Object.entries(counts)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`GitHub returned an invalid ${key} count.`);
  }
  return { repository, recordedAt: now.toISOString(), ...counts };
}

export function summary(stats) {
  return `## Repository snapshot\n\nRepository: ${stats.repository}\n\nRecorded: ${stats.recordedAt}\n\n| Metric | Count |\n| --- | ---: |\n| Stars | ${stats.stars} |\n| Forks | ${stats.forks} |\n| Open issues and pull requests | ${stats.openIssuesAndPullRequests} |\n| Watchers | ${stats.watchers} |\n\nDaily snapshots begin when this workflow is enabled. Download the JSON artifacts to compare dates; retention is 90 days. Counts may decrease when people unstar or delete forks.\n`;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: node scripts/github-stats.mjs [owner/repo] [--output path.json]\nDefaults to GITHUB_REPOSITORY or jntv/app2reel. Optional GH_TOKEN or GITHUB_TOKEN increases API access. Writes a GitHub Actions summary when GITHUB_STEP_SUMMARY is set.');
    return;
  }
  let repository = process.env.GITHUB_REPOSITORY || 'jntv/app2reel';
  let output;
  let positional = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output' && args[i + 1] && !output) output = args[++i];
    else if (!args[i].startsWith('-') && !positional) { repository = args[i]; positional = true; }
    else throw new Error('Invalid arguments. Run with --help for usage.');
  }
  const stats = await collectStats(repository, { token: process.env.GH_TOKEN || process.env.GITHUB_TOKEN });
  const json = `${JSON.stringify(stats, null, 2)}\n`;
  if (output) { await mkdir(path.dirname(path.resolve(output)), { recursive: true }); await writeFile(output, json); }
  if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, summary(stats), { flag: 'a' });
  process.stdout.write(json);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`App2Reel stats: ${error.message}`); process.exitCode = 1; });
}
