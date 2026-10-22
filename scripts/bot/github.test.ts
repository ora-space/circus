import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ghGitHub } from './github.ts';
import { fakeContext } from '../lib/testing.ts';

test('ghGitHub maps the port onto REST calls through gh api', () => {
  const { ctx, calls } = fakeContext((args) =>
    args[3].endsWith('/assignees') ? '{"assignees":[{"login":"bob"}]}' : args[3].endsWith('/permission') ? '{"permission":"write"}' : '',
  );
  const gh = ghGitHub(ctx.gh, 'o/r');
  gh.setLabels(3, ['repo:desktop']);
  assert.deepEqual(gh.addAssignees(3, ['bob', 'x']), ['bob']);
  gh.react(9, '+1');
  gh.reopen(3);
  assert.equal(gh.permission('bob'), 'write');
  gh.addSubIssue(3, 77);
  gh.addBlockedBy(3, 55);
  gh.removeBlockedBy(3, 55);
  assert.deepEqual(
    calls.map((c) => `${c.args[2]} ${c.args[3]} ${c.input}`),
    [
      'PUT repos/o/r/issues/3/labels {"labels":["repo:desktop"]}',
      'POST repos/o/r/issues/3/assignees {"assignees":["bob","x"]}',
      'POST repos/o/r/issues/comments/9/reactions {"content":"+1"}',
      'PATCH repos/o/r/issues/3 {"state":"open"}',
      'GET repos/o/r/collaborators/bob/permission undefined',
      'POST repos/o/r/issues/3/sub_issues {"sub_issue_id":77}',
      'POST repos/o/r/issues/3/dependencies/blocked_by {"issue_id":55}',
      'DELETE repos/o/r/issues/3/dependencies/blocked_by/55 undefined',
    ],
  );
});

test('product calls go through the product token, and fail without one', () => {
  const circus = fakeContext();
  const products = fakeContext((args) => (args[3].includes('/actions/runs?') ? '{"workflow_runs":[]}' : '{}'));
  const gh = ghGitHub(circus.ctx.gh, 'o/r', products.ctx.gh);
  gh.getPull('desktop', 12);
  assert.deepEqual(gh.pullRuns('desktop', 'abc'), []);
  gh.rerunFailedJobs('desktop', 34);
  assert.equal(circus.calls.length, 0);
  assert.deepEqual(
    products.calls.map((c) => `${c.args[2]} ${c.args[3]}`),
    [
      'GET repos/o/desktop/pulls/12',
      'GET repos/o/desktop/actions/runs?event=pull_request&head_sha=abc&per_page=100',
      'POST repos/o/desktop/actions/runs/34/rerun-failed-jobs',
    ],
  );
  assert.throws(() => ghGitHub(circus.ctx.gh, 'o/r').getPull('desktop', 12), /没有产品仓库的 token/);
});
