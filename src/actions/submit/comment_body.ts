import { TContext } from '../../lib/context';
import { TBranchPRInfo } from '../../lib/engine/metadata_ref';

export function generateStackComment(
  context: TContext,
  forBranchName: string
): string {
  const lines = [];
  const trunk = context.engine.trunk;

  const owner = context.repoConfig.getRepoOwner();
  const repo = context.repoConfig.getRepoName();
  const forPr = context.engine.getPrInfo(forBranchName);

  const buildChildPrLink = (pr: TBranchPRInfo) => {
    return `[#${pr.number}](https://github.com/${owner}/${repo}/pull/${pr.number}) <a href="https://app.graphite.dev/github/pr/${owner}/${repo}/${pr.number}" target="_self"><img src="https://static.graphite.dev/graphite-32x32-black.png" alt="Graphite" width="10px" height="10px"/></a>`;
  };
  const buildLine = (branchName: string) => {
    const pr = context.engine.getPrInfo(branchName);
    if (!pr) {
      return `Branch _${branchName}_`;
    }

    const children = context.engine.getChildren(branchName);
    let line = `**#${pr.number}** <a href="https://app.graphite.dev/github/pr/${owner}/${repo}/${pr.number}" target="_self"><img src="https://static.graphite.dev/graphite-32x32-black.png" alt="Graphite" width="10px" height="10px"/></a>`;
    if (children.length > 1) {
      // If multiple children, add a line for all the children and stop traversing the tree.
      const isBuildingForChild = children.includes(forBranchName);
      const childrenPrs = children
        .filter((branchName) => forBranchName !== branchName)
        .map((branchName) => {
          const pr = context.engine.getPrInfo(branchName);
          if (!pr) {
            return `Branch _${branchName}_`;
          }
          return buildChildPrLink(pr);
        });
      if (isBuildingForChild) {
        line += ` Other dependent PRs: (${childrenPrs.join(', ')})`;
      } else {
        line += ` Dependent PRs: (${childrenPrs.join(', ')})`;
      }
    }
    if (forPr?.number === pr.number) {
      line += ' 👈';
    }
    return line;
  };

  // Explore up the tree from the current PR
  let currentBranchName: string | undefined = forBranchName;
  while (currentBranchName) {
    const children = context.engine.getChildren(currentBranchName);
    lines.unshift(buildLine(currentBranchName));
    if (children.length > 1) {
      // If multiple children, stop traversing the tree since we don't know which branch to follow.
      break;
    }
    currentBranchName = children[0];
  }

  // Explore down the tree from the current PR to the trunk branch
  currentBranchName = context.engine.getParent(forBranchName);
  while (currentBranchName && currentBranchName !== trunk) {
    lines.push(buildLine(currentBranchName));
    currentBranchName = context.engine.getParent(currentBranchName);
  }
  lines.push(`\`${trunk}\``);

  return [
    ...lines.map((l) => `* ${l}`),
    '',
    'This comment was autogenerated by Pancake.',
  ].join('\n');
}
