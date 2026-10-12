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
