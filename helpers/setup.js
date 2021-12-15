import { spawnSync } from 'child_process';
import * as log from './log.js'

const swapfile = 'swap__';
const swapsize = '128M';

// linuxize.com/post/create-a-linux-swap-file
export function mkswap() {
    return !hasswap() &&
        sh('fallocate', ['-l', swapsize, swapfile]) &&
        sh('chmod', ['600', swapfile]) &&
        sh('mkswap', swapfile) &&
        sh('swapon', swapfile) &&
        sh('sysctl', 'vm.swappiness=25')
}

export function rmswap() {
    return hasswap() &&
        sh('swapoff', ['-v', swapfile]) &&
        sh('rm', [swapfile])
}

// stackoverflow.com/a/53222213
function hasswap() {
    return sh('test' ['-e', swapfile]);
}

function sh(cmd, args) {
    if (!cmd) return;
    args = args || [];
    const opts = {
        cwd: '/',
        uid: 0,
        shell: true,
    }
    const proc = spawnSync(cmd, args, opts);
    if (proc.error) log.i(cmd, args, opts, "error", proc.error);
    if (proc.stderr) log.e(cmd, args, opts, proc.stderr);
    if (proc.stdout) log.g(proc.stdout);
    return (proc.status === 0);
}

