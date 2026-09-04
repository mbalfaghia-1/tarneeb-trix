import type { TrixContract } from '@tarneeb/engine';
import type { T } from '../i18n';

const NAME_KEY = {
  kingOfHearts: 'c_kingOfHearts',
  diamonds: 'c_diamonds',
  queens: 'c_queens',
  collection: 'c_collection',
  trix: 'c_trix',
  complex: 'c_complex',
} as const;

const DESC_KEY = {
  kingOfHearts: 'cd_kingOfHearts',
  diamonds: 'cd_diamonds',
  queens: 'cd_queens',
  collection: 'cd_collection',
  trix: 'cd_trix',
  complex: 'cd_complex',
} as const;

export const contractName = (t: T, c: TrixContract): string => t(NAME_KEY[c]);
export const contractDesc = (t: T, c: TrixContract): string => t(DESC_KEY[c]);

export const CONTRACT_ICON: Record<TrixContract, string> = {
  kingOfHearts: '♥',
  diamonds: '♦',
  queens: '♛',
  collection: '✋',
  trix: '🂫',
  complex: '☠',
};
