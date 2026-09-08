'use client';
import { useSyncExternalStore } from 'react';
import type { SystemInfo } from './types';
import { VYOS_NODE_TRAINS } from './vyos-trains.generated';

// Which VyOS release the router runs. The schema marks nodes that only
// some trains have; the UI hides the rest so nothing is offered that
// the router would refuse. Learned once per session from /api/system.
export type VyosTrain = 'sagitta' | 'circinus' | 'rolling';

/** Oldest to newest, as the generator lists them. */
export const VYOS_TRAINS: VyosTrain[] = ['sagitta', 'circinus', 'rolling'];

export const TRAIN_LABEL: Record<VyosTrain, string> = {
  sagitta: 'VyOS 1.4 (sagitta, LTS)',
  circinus: 'VyOS 1.5 (circinus)',
  rolling: 'VyOS rolling',
};

/**
 * The train from what `show version` reports: `release_train` when the
 * image carries one (older rolling images said `current`), otherwise
 * the version string. Anything unrecognised is treated as rolling, the
 * newest and most permissive.
 */
export function trainOf(info: Pick<SystemInfo, 'version' | 'release_train'>): VyosTrain {
  const train = info.release_train.trim().toLowerCase();
  if (train === 'sagitta' || train === 'circinus' || train === 'rolling') return train;
  if (train === 'current') return 'rolling';
  const version = info.version.trim().toLowerCase();
  if (version.includes('rolling')) return 'rolling';
  if (version.startsWith('1.4')) return 'sagitta';
  if (version.startsWith('1.5')) return 'circinus';
  return 'rolling';
}

/** Whether a config node (`["nat", "cgnat"]`) exists on a train: it and every ancestor must. */
export function available(path: string[], train: VyosTrain): boolean {
  for (let i = 1; i <= path.length; i++) {
    const only = VYOS_NODE_TRAINS[path.slice(0, i).join(' ')];
    if (only && !only.includes(train)) return false;
  }
  return true;
}

let current: VyosTrain = 'rolling';
const listeners = new Set<() => void>();

export function setTrain(train: VyosTrain): void {
  if (train === current) return;
  current = train;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useTrain(): VyosTrain {
  return useSyncExternalStore(subscribe, () => current, () => 'rolling');
}
