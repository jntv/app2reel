import test from 'node:test';
import assert from 'node:assert/strict';

const modulePath = '../scripts/github-stats.mjs';
const { collectStats, repositoryName } = await import(modulePath);

test('repository stats distinguish stars from watchers and retain a dated snapshot', async () => {
  let requestUrl = '';
  const result = await collectStats('jntv/app2reel', {
    now: new Date('2026-10-27T02:17:00Z'),
    fetchImpl: async (url: string, options: RequestInit) => {
      requestUrl = url;
      assert.equal(options.redirect, 'error');
      return new Response(JSON.stringify({ stargazers_count: 42, forks_count: 7, open_issues_count: 3, subscribers_count: 2 }));
    },
  });
  assert.equal(requestUrl, 'https://api.github.com/repos/jntv/app2reel');
  assert.deepEqual(result, { repository: 'jntv/app2reel', recordedAt: '2026-10-27T02:17:00.000Z', stars: 42, forks: 7, openIssuesAndPullRequests: 3, watchers: 2 });
});

test('stats reject non-GitHub repository inputs before sending credentials', async () => {
  for (const invalid of ['https://example.com/repo', 'owner/repo?token=secret', 'owner/repo/extra', '../repo']) {
    assert.throws(() => repositoryName(invalid), /owner\/repo/);
  }
  await assert.rejects(collectStats('https://example.com/repo', {
    token: 'secret',
    fetchImpl: async () => { throw new Error('must not fetch'); },
  }), /owner\/repo/);
});

test('stats report unavailable repos and malformed counts without logging API responses', async () => {
  await assert.rejects(collectStats('jntv/app2reel', { fetchImpl: async () => new Response('private details', { status: 404 }) }), /Publish it first/);
  await assert.rejects(collectStats('jntv/app2reel', { fetchImpl: async () => new Response(JSON.stringify({ stargazers_count: -1, forks_count: 0, open_issues_count: 0, subscribers_count: 0 })) }), /invalid stars count/);
});
