import chalk from 'chalk';
import { TContext } from '../../lib/context';
import { TScopeSpec } from '../../lib/engine/scope_spec';
import { ExitFailedError, KilledError } from '../../lib/errors';
import { getPRInfoForBranches } from './prepare_branches';
import {
  requestServerToSubmitPRs,
  submitPullRequest,
  TPRSubmissionInfo,
} from './submit_prs';
import { validateBranchesToSubmit } from './validate_branches';
import { Octokit } from '@octokit/core';
import { generateStackComment } from './comment_body';
import { CommandFailedError } from '../../lib/git/runner';

// eslint-disable-next-line max-lines-per-function
export async function submitAction(
  args: {
    scope: TScopeSpec;
    editPRFieldsInline: boolean | undefined;
    draft: boolean;
    publish: boolean;
    dryRun: boolean;
    updateOnly: boolean;
    reviewers: string | undefined;
    confirm: boolean;
    forcePush: boolean;
    select: boolean;
    always: boolean;
    branch: string | undefined;
    mergeWhenReady: boolean;
  },
  context: TContext
): Promise<void> {
  // Check CLI pre-condition to warn early
  if (args.draft && args.publish) {
    throw new ExitFailedError(
      `Can't use both --publish and --draft flags in one command`
    );
  }
  const populateRemoteShasPromise = context.engine.populateRemoteShas();
  if (args.dryRun) {
    context.splog.info(
      chalk.yellow(
        `Running submit in 'dry-run' mode. No branches will be pushed and no PRs will be opened or updated.`
      )
    );
    context.splog.newline();
    args.editPRFieldsInline = false;
  }

  if (!context.interactive) {
    args.editPRFieldsInline = false;
    args.reviewers = undefined;

    context.splog.info(
      `Running in non-interactive mode. Inline prompts to fill PR fields will be skipped${
        !(args.draft || args.publish)
          ? ' and new PRs will be created in draft mode'
          : ''
      }.`
    );
    context.splog.newline();
  }

  const allBranchNames = context.engine
    .getRelativeStack(context.engine.currentBranchPrecondition, args.scope)
    .filter((branchName) => !context.engine.isTrunk(branchName));

  const branchNames = args.select
    ? await selectBranches(context, allBranchNames)
    : allBranchNames;

  context.splog.info(
    chalk.blueBright(
      '🥞 Validating that this Pancake stack is ready to submit...'
    )
  );
  context.splog.newline();
  await validateBranchesToSubmit(branchNames, context);

  context.splog.info(
    chalk.blueBright(
      '✏️  Preparing to submit PRs for the following branches...'
    )
  );
  await populateRemoteShasPromise;
  const submissionInfos = await getPRInfoForBranches(
    {
      branchNames: branchNames,
      editPRFieldsInline: args.editPRFieldsInline && context.interactive,
      draft: args.draft,
      publish: args.publish,
      updateOnly: args.updateOnly,
      reviewers: args.reviewers,
      dryRun: args.dryRun,
      select: args.select,
      always: args.always,
    },
    context
  );

  if (
    await shouldAbort(
      { ...args, hasAnyPrs: submissionInfos.length > 0 },
      context
    )
  ) {
    return;
  }

  context.splog.info(
    chalk.blueBright('📨 Pushing to remote and creating/updating PRs...')
  );

  await preparePrsForUpdate(submissionInfos, context, args);

  // Now that existing PRs aren't pointing to the base branches, delete the old base branches and recreate them.
  // We cannot push directly to the base branches because of branch protection rules on the base branches.
  const branchesToDelete = submissionInfos.flatMap((info) => [
    { src: '', dest: remoteDest(baseBranchName(info.head)) },
  ]);
  context.engine.pushBulk({
    branches: branchesToDelete,
    forcePush: args.forcePush,
  });
  const branchesToRecreate = submissionInfos.flatMap((info) => {
    if (!info.headSha) {
      throw new ExitFailedError('Head SHA is required');
    }
    if (!info.baseSha) {
      throw new ExitFailedError('Base SHA is required');
    }
    return [
      { src: info.headSha, dest: remoteDest(info.head) },
      { src: info.baseSha, dest: remoteDest(baseBranchName(info.head)) },
      // For any existing PRs, we also update the temporary base branches at the same time as we update the PRs'
      // head branches. This ensures that the PRs always contains only the desired diffs and no unrelated commits.
      { src: info.baseSha, dest: remoteDest(tempBaseBranchName(info.head)) },
    ];
  });
  context.engine.pushBulk({
    branches: branchesToRecreate,
    forcePush: args.forcePush,
  });

  // Update or create PRs using the real base branches
  // TODO: do this in batch
  for (const submissionInfo of submissionInfos) {
    await submitPullRequest(submissionInfo, context);
  }

  // Delete the temporary branches
  const tempBranchesToDelete = submissionInfos.flatMap((info) => [
    { src: '', dest: remoteDest(tempBaseBranchName(info.head)) },
  ]);
  context.engine.pushBulk({
    branches: tempBranchesToDelete,
    forcePush: args.forcePush,
  });

  await commentStackOnPrs(branchNames, context);

  if (!context.interactive) {
    return;
  }
}

/** Write a comment on each PR in the stack that explains the topology of the stack. */
async function commentStackOnPrs(
  branchNames: Array<string>,
  context: TContext
) {
  const auth = context.userConfig.getFPAuthToken();
  if (!auth) {
    throw new Error(
      'No pancake auth token found. Run `pc auth-fp -t <YOUR_GITHUB_TOKEN>` then try again.'
    );
  }

  const octokit = new Octokit({ auth });
  const owner = context.repoConfig.getRepoOwner();
  const repo = context.repoConfig.getRepoName();

  for (const branchName of branchNames) {
    const pr = context.engine.getPrInfo(branchName);
    if (!pr?.number) {
      continue;
    }
    const existing = await octokit.request(
      'GET /repos/{owner}/{repo}/issues/{issue_number}/comments',
      {
        owner,
        repo,
        issue_number: pr.number,
        headers: {
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    );

    const update = existing.data.find((comment) =>
      comment.body?.includes('This comment was autogenerated by Pancake.')
    );

    if (update) {
      await octokit.request(
        'PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}',
        {
          owner,
          repo,
          comment_id: update.id,
          body: generateStackComment(context, branchName),
          headers: {
            'X-GitHub-Api-Version': '2022-11-28',
          },
        }
      );
    } else {
      await octokit.request(
        'POST /repos/{owner}/{repo}/issues/{issue_number}/comments',
        {
          owner,
          repo,
          issue_number: pr.number,
          body: generateStackComment(context, branchName),
          headers: {
            'X-GitHub-Api-Version': '2022-11-28',
          },
        }
      );
    }
  }
}

const baseBranchName = (branchName: string) => `mq/${branchName}`;
const tempBaseBranchName = (branchName: string) => `temp-mq/${branchName}`;
const remoteDest = (branchName: string) => `refs/heads/${branchName}`;

/** Since the `mq/***` branches have branch protection rules that prevent updates without a PR, we have to
go through a little roundabout process: we have to delete the old branches and recreate them to point
to the new desired refs. But we also have to take care to not accidentally close the PRs while we do this */
async function preparePrsForUpdate(
  submissionInfos: TPRSubmissionInfo,
  context: TContext,
  args: { forcePush: boolean }
): Promise<void> {
  const prsToUpdate = submissionInfos.filter(
    (info) => info.action === 'update'
  );
  if (prsToUpdate.length === 0) {
    return;
  }

  // Verify that there aren't incompatible changes on the remote
  const dryRunHeads = prsToUpdate.map((info) => {
    if (!info.headSha) {
      throw new ExitFailedError('Head SHA is required');
    }
    return {
      src: info.headSha,
      dest: remoteDest(info.head),
    };
  });
  try {
    context.engine.pushBulk({
      branches: dryRunHeads,
      dryRun: true,
      forcePush: args.forcePush,
    });
  } catch (err) {
    if (
      err instanceof CommandFailedError &&
      err.message.includes('stale info')
    ) {
      throw new ExitFailedError(
        [
          'Force-with-lease push of branch failed due to external changes to the remote branch.',
          'Collaborating on stacks is not well supported in pancake. You can attempt to manually pull in changes from the remote, but proceed with caution.',
          'Alternatively, use the `--force` option of this command to bypass the stale info warning.',
        ].join('\n')
      );
    }
    throw err;
  }

  // First, create a temporary branch that is identical to the current base of the PR
  const tempBranchesToDelete = prsToUpdate.map((info) => ({
    src: '',
    dest: remoteDest(tempBaseBranchName(info.head)),
  }));
  context.engine.pushBulk({
    branches: tempBranchesToDelete,
    forcePush: args.forcePush,
  });

  const tempBranchesToPush = prsToUpdate.map((info) => ({
    src: `${context.engine.remote}/${baseBranchName(info.head)}`,
    dest: remoteDest(tempBaseBranchName(info.head)),
  }));
  context.engine.pushBulk({
    branches: tempBranchesToPush,
    forcePush: args.forcePush,
  });

  // Then, update all existing PRs' base to point to the new temporary branch
  const submissionInfosWithTempBranches = prsToUpdate
    .filter((info) => info.action === 'update')
    .map((info) => ({
      ...info,
      base: tempBaseBranchName(info.head),
    }));
  await requestServerToSubmitPRs({
    submissionInfo: submissionInfosWithTempBranches,
    context,
  });
}

async function selectBranches(
  context: TContext,
  branchNames: string[]
): Promise<string[]> {
  const result = [];
  for (const branchName of branchNames) {
    const selected = (
      await context.prompts({
        name: 'value',
        initial: true,
        type: 'confirm',
        message: `Would you like to submit ${chalk.cyan(branchName)}?`,
      })
    ).value;
    // Clear the prompt result
    process.stdout.moveCursor(0, -1);
    process.stdout.clearLine(1);
    if (selected) {
      result.push(branchName);
    }
  }
  return result;
}

async function shouldAbort(
  args: { dryRun: boolean; confirm: boolean; hasAnyPrs: boolean },
  context: TContext
): Promise<boolean> {
  if (args.dryRun) {
    context.splog.info(chalk.blueBright('✅ Dry run complete.'));
    return true;
  }

  if (!args.hasAnyPrs) {
    context.splog.info(chalk.blueBright('🆗 All PRs up to date.'));
    return true;
  }

  if (
    context.interactive &&
    args.confirm &&
    !(
      await context.prompts({
        type: 'confirm',
        name: 'value',
        message: 'Continue with this submit operation?',
        initial: true,
      })
    ).value
  ) {
    context.splog.info(chalk.blueBright('🛑 Aborted submit.'));
    throw new KilledError();
  }

  return false;
}
