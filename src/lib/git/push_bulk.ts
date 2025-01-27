import { runGitCommand } from './runner';

export function pushBulk(opts: {
  remote: string;
  branches: { dest: string; src: string }[];
  dryRun?: boolean;
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
      ...(opts.dryRun ? ['--dry-run'] : []),
    ],
    options: { stdio: 'pipe' },
    onError: 'throw',
    resource: 'pushBranch',
  });
}
