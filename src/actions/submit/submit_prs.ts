import * as t from '@withgraphite/retype';
import chalk from 'chalk';
import { TContext } from '../../lib/context';
import { ExitFailedError } from '../../lib/errors';
import { Unpacked } from '../../lib/utils/ts_helpers';

import { Octokit } from '@octokit/core';

const submitPullRequestsParams = {
  authToken: t.optional(t.string),
  repoOwner: t.string,
  repoName: t.string,
  trunkBranchName: t.optional(t.string),
  mergeWhenReady: t.optional(t.boolean),
  prs: t.array(
    t.unionMany([
      t.shape({
        action: t.literals(['create'] as const),
        head: t.string,
        headSha: t.optional(t.string),
        base: t.string,
        baseSha: t.optional(t.string),
        title: t.string,
        body: t.optional(t.string),
        draft: t.optional(t.boolean),
        reviewers: t.optional(t.array(t.string)),
      }),
      t.shape({
        action: t.literals(['update'] as const),
        head: t.string,
        headSha: t.optional(t.string),
        base: t.string,
        baseSha: t.optional(t.string),
        title: t.optional(t.string),
        body: t.optional(t.string),
        prNumber: t.number,
        draft: t.optional(t.boolean),
      }),
    ])
  ),
};

const submitPullRequestResponse = {
  prs: t.array(
    t.unionMany([
      t.shape({
        head: t.string,
        prNumber: t.number,
        prURL: t.string,
        status: t.literals(['updated', 'created', 'noop'] as const),
      }),
      t.shape({
        head: t.string,
        error: t.string,
        status: t.literals(['error'] as const),
      }),
    ])
  ),
};

export type TPRSubmissionInfo = t.UnwrapSchemaMap<
  typeof submitPullRequestsParams
>['prs'];

type TSubmittedPRRequest = Unpacked<TPRSubmissionInfo>;

type TSubmittedPRResponse = Unpacked<
  t.UnwrapSchemaMap<typeof submitPullRequestResponse>['prs']
>;

type TSubmittedPR = {
  request: TSubmittedPRRequest;
  response: TSubmittedPRResponse;
};

export async function submitPullRequest(
  args: {
    submissionInfo: TPRSubmissionInfo;
    mergeWhenReady: boolean;
    trunkBranchName: string;
  },
  context: TContext
): Promise<void> {
  const pr = (
    await requestServerToSubmitPRs({
      submissionInfo: args.submissionInfo,
      mergeWhenReady: args.mergeWhenReady,
      trunkBranchName: args.trunkBranchName,
      context,
    })
  )[0];

  if (pr.response.status === 'error') {
    throw new ExitFailedError(
      `Failed to submit PR for ${pr.response.head}: ${parseSubmitError(
        pr.response.error
      )}`
    );
  }

  context.engine.upsertPrInfo(pr.response.head, {
    number: pr.response.prNumber,
    url: pr.response.prURL,
    base: pr.request.base,
    state: 'OPEN', // We know this is not closed or merged because submit succeeded
    ...(pr.request.action === 'create'
      ? {
          title: pr.request.title,
          body: pr.request.body,
          reviewDecision: 'REVIEW_REQUIRED', // Because we just opened this PR
        }
      : {}),
    ...(pr.request.draft !== undefined ? { draft: pr.request.draft } : {}),
  });
  context.splog.info(
    `${chalk.green(pr.response.head)}: ${pr.response.prURL} (${{
      updated: chalk.yellow,
      created: chalk.green,
      noop: chalk.gray,
    }[pr.response.status](pr.response.status)})`
  );
}

function parseSubmitError(error: string): string {
  try {
    return JSON.parse(error)?.response?.data?.message ?? error;
  } catch {
    return error;
  }
}

// This endpoint is plural for legacy reasons.
// Leaving the function plural in case we want to revert.
async function requestServerToSubmitPRs({
  submissionInfo,
  mergeWhenReady: __mergeWhenReady,
  trunkBranchName: __trunkBranchName,
  context,
}: {
  submissionInfo: TPRSubmissionInfo;
  mergeWhenReady: boolean;
  trunkBranchName: string;
  context: TContext;
}): Promise<TSubmittedPR[]> {
  const auth = context.userConfig.getFPAuthToken();
  if (!auth) {
    throw new Error(
      'No pancake auth token found. Run `pc auth-fp -t <YOUR_GITHUB_TOKEN>` then try again.'
    );
  }

  const octokit = new Octokit({ auth });

  const owner = context.repoConfig.getRepoOwner();
  const repo = context.repoConfig.getRepoName();

  const prs = [];
  for (const info of submissionInfo) {
    const baseBranchName = `mq/${info.head}`;
    if (info.action === 'create') {
      const pr = await octokit.request('POST /repos/{owner}/{repo}/pulls', {
        owner,
        repo,
        title: info.title,
        body: info.body,
        head: info.head,
        base: baseBranchName,
        draft: info.draft,
        headers: { 'X-GitHub-Api-Version': '2022-11-28' },
      });
      prs.push({ pr, action: 'created' });
    }

    if (info.action === 'update') {
      // Maybe only do this if there is something to update
      const existingPr = await octokit.request(
        'GET /repos/{owner}/{repo}/pulls/{pull_number}',
        {
          owner,
          repo,
          pull_number: info.prNumber,
        }
      );
      const changed = (info.title && existingPr.data.title !== info.title) || (info.body && existingPr.data.body !== info.body) || existingPr.data.base.ref !== baseBranchName;
      if (changed) {
        const pr = await octokit.request(
          'PATCH /repos/{owner}/{repo}/pulls/{pull_number}',
          {
            owner,
            repo,
            pull_number: info.prNumber,
            title: info.title,
            body: info.body,
            base: baseBranchName,
            headers: { 'X-GitHub-Api-Version': '2022-11-28' },
          }
        );
        prs.push({ pr, action: 'updated' });
      } else {
        prs.push({ pr: existingPr, action: 'noop' });
      };
    }
  }

  const requests: { [head: string]: TSubmittedPRRequest } = {};
  submissionInfo.forEach((prRequest) => {
    requests[prRequest.head] = prRequest;
  });

  return prs.map(({ pr, action }) => {
    const request = requests[pr.data.head.ref];
    return {
      request,
      response: {
        head: pr.data.head.ref,
        status: action as 'updated' | 'created' | 'noop',
        prNumber: pr.data.number,
        prURL: pr.data.html_url,
      },
    };
  });
}
