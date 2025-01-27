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
  submissionInfo: TPRSubmissionInfo[0],
  context: TContext
): Promise<void> {
  // The `base` branch of the prInfo identifies the parent upon which this PR depends.
  // But the base branch we submit for the PR is always an `mq/***` branch.
  const prInfoToSubmit = {
    ...submissionInfo,
    base: `mq/${submissionInfo.head}`,
  };
  const pr = (
    await requestServerToSubmitPRs({
      submissionInfo: [prInfoToSubmit],
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
    base: submissionInfo.base,
    state: 'OPEN', // We know this is not closed or merged because submit succeeded
    ...(submissionInfo.action === 'create'
      ? {
          title: submissionInfo.title,
          body: submissionInfo.body,
          reviewDecision: 'REVIEW_REQUIRED', // Because we just opened this PR
        }
      : {}),
    ...(submissionInfo.draft !== undefined
      ? { draft: submissionInfo.draft }
      : {}),
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
export async function requestServerToSubmitPRs({
  submissionInfo,
  context,
}: {
  submissionInfo: TPRSubmissionInfo;
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
    if (info.action === 'create') {
      const pr = await octokit.request('POST /repos/{owner}/{repo}/pulls', {
        owner,
        repo,
        title: info.title,
        body: info.body,
        head: info.head,
        base: info.base,
        draft: info.draft,
        headers: { 'X-GitHub-Api-Version': '2022-11-28' },
      });
      prs.push({ pr, action: 'created' });
    }

    if (info.action === 'update') {
      const existingPr = await octokit.request(
        'GET /repos/{owner}/{repo}/pulls/{pull_number}',
        {
          owner,
          repo,
          pull_number: info.prNumber,
        }
      );
      const changed =
        (info.title && existingPr.data.title !== info.title) ||
        (info.body && existingPr.data.body !== info.body) ||
        existingPr.data.base.ref !== info.base;
      if (changed) {
        const pr = await octokit.request(
          'PATCH /repos/{owner}/{repo}/pulls/{pull_number}',
          {
            owner,
            repo,
            pull_number: info.prNumber,
            title: info.title,
            body: info.body,
            base: info.base,
            headers: { 'X-GitHub-Api-Version': '2022-11-28' },
          }
        );
        prs.push({ pr, action: 'updated' });
      } else {
        prs.push({ pr: existingPr, action: 'noop' });
      }
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
