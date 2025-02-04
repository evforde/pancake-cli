import { getPrInfoForBranches, TPRInfoToUpsert } from '../lib/api/pr_info';
import { TContext } from '../lib/context';
import { TEngine } from '../lib/engine/engine';

export async function syncPrInfo(
  branchNames: string[],
  context: TContext
): Promise<TPRInfoToUpsert> {
  const authToken = context.userConfig.getFPAuthToken();
  if (!authToken) {
    throw new Error(
      'No pancake auth token found. Run `pc auth-fp -t <YOUR_GITHUB_TOKEN>` then try again.'
    );
  }

  const upsertInfo = await getPrInfoForBranches(
    branchNames.map((branchName) => ({
      branchName,
      prNumber: context.engine.getPrInfo(branchName)?.number,
    })),
    {
      authToken,
      repoName: context.repoConfig.getRepoName(),
      repoOwner: context.repoConfig.getRepoOwner(),
    },
    context.userConfig
  );

  upsertPrInfoForBranches(upsertInfo, context.engine);

  return upsertInfo;
}

export function upsertPrInfoForBranches(
  prInfoToUpsert: TPRInfoToUpsert,
  engine: TEngine
): void {
  prInfoToUpsert.forEach((pr) =>
    engine.upsertPrInfo(pr.headRefName, {
      number: pr.prNumber,
      title: pr.title,
      body: pr.body,
      state: pr.state,
      reviewDecision: pr.reviewDecision ?? undefined,
      url: pr.url,
      isDraft: pr.isDraft,
      // Don't update the base of the PR from the github info since the base branch is different from the PR's
      // parent branch.
      // TODO: this is a little bit fickle. We should do a larger refactor to track `parent` separately from `base`.
    })
  );
}
