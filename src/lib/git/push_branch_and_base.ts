import { runGitCommand } from './runner';

export function pushBranchAndBase(opts: {
  remote: string;
  baseSha: string;
  branchName: string;
  noVerify: boolean;
  forcePush: boolean;
}): void {
  const forceOption = opts.forcePush ? '--force' : '--force-with-lease';
  const baseBranchName = `mq/${opts.branchName}`;
  runGitCommand({
    args: [
      `push`,
      opts.remote,
      forceOption,
      opts.branchName,
      `${opts.baseSha}:refs/heads/${baseBranchName}`,
      ...(opts.noVerify ? ['--no-verify'] : []),
    ],
    options: { stdio: 'pipe' },
    onError: 'throw',
    resource: 'pushBranch',
  });
}
