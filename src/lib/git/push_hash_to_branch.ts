import { runGitCommand } from './runner';

export function pushHashToBranch(opts: {
  remote: string;
  hash: string;
  branchName: string;
  noVerify: boolean;
  forcePush: boolean;
}): void {
  const forceOption = opts.forcePush ? '--force' : '--force-with-lease';
  runGitCommand({
    args: [
      `push`,
      opts.remote,
      forceOption,
      `${opts.hash}:refs/heads/${opts.branchName}`,
      ...(opts.noVerify ? ['--no-verify'] : []),
    ],
    options: { stdio: 'pipe' },
    onError: 'throw',
    resource: 'pushBranch',
  });
}
