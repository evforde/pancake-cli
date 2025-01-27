import { runGitCommand } from './runner';

export function pushBulk(opts: {
  remote: string;
  branches: { dest: string; src: string }[];
  noVerify: boolean;
  forcePush: boolean;
}): void {
  const forceOption = opts.forcePush ? '--force' : '--force-with-lease';
  runGitCommand({
    args: [
      `push`,
      opts.remote,
      forceOption,
      ...opts.branches.map((branch) => `${branch.src}:${branch.dest}`),
      ...(opts.noVerify ? ['--no-verify'] : []),
    ],
    options: { stdio: 'pipe' },
    onError: 'throw',
    resource: 'pushBranch',
  });
}
