import type { ReactNode } from 'react';
import {
  SEATS,
  type Card,
  type CompletedTrick,
  type Seat,
  type TrixContract,
  type TrixState,
} from '@tarneeb/engine';
import { turnName } from '../../game/labels';
import { CONTRACT_ICON } from '../../game/trixLabels';
import type { T } from '../../i18n';
import { LastTrick } from '../LastTrick';
import { TrixScoreboard } from './TrixScoreboard';
import { TrixSeat } from './TrixSeat';
import { TrixTrick } from './TrixTrick';
import { SheddingBoard } from './SheddingBoard';
import { TrixHand } from './TrixHand';
import { ContractModal } from './ContractModal';
import { DoubleModal } from './DoubleModal';

/**
 * The one Trix board, shared by single-player (`TrixScreen`) and online
 * (`OnlineTrixBoard`) so they look and behave identically. The board assumes the
 * viewer sits at seat 0 (single-player already does; online rotates the state so it
 * does too). Callers differ only in where the state comes from and what they render
 * on top (overlays / leave button) via `children`.
 */
export interface TrixBoardProps {
  state: TrixState;
  t: T;
  /** The viewer may act right now (already excludes trick-review pauses). */
  awaitingHuman: boolean;
  /** A just-completed trick to hold on the table for a beat, or null. */
  reviewTrick: CompletedTrick | null;
  onChooseContract: (contract: TrixContract) => void;
  onSetDouble: (cards: Card[]) => void;
  onPlay: (card: Card) => void;
  /** Real player names (online). Omit to use positional labels (You/Partner/…). */
  nameFor?: (seat: Seat) => string;
  /** Real hand sizes (online redacts other hands). Omit to read them from state. */
  countFor?: (seat: Seat) => number;
  /** Show a countdown bar while awaiting the human. */
  turnTimer?: { limitMs: number; token: string };
  /** Screen-specific extras rendered inside the board (overlays, leave button). */
  children?: ReactNode;
}

export function TrixBoard({
  state,
  t,
  awaitingHuman,
  reviewTrick,
  onChooseContract,
  onSetDouble,
  onPlay,
  nameFor,
  countFor,
  turnTimer,
  children,
}: TrixBoardProps) {
  const label = (s: Seat) => nameFor?.(s) ?? turnName(s, t);

  const humanContract = awaitingHuman && state.phase === 'contract-select';
  const humanDoubling = awaitingHuman && state.phase === 'doubling';
  const contractShown = state.contract && (state.phase === 'playing' || state.phase === 'shedding');
  const redContract = state.contract === 'kingOfHearts' || state.contract === 'diamonds';

  let status = '';
  if (state.phase === 'deal-over' || state.phase === 'game-over') status = '';
  else if (awaitingHuman)
    status =
      state.phase === 'contract-select'
        ? t('chooseContract')
        : state.phase === 'doubling'
          ? t('double_title')
          : t('yourTurn');
  else if (state.phase === 'contract-select') status = t('waitingFor', { name: label(state.king) });
  else if (state.phase === 'doubling') status = t('doublingWait', { name: label(state.turn) });
  else if (state.turn === 0) status = ''; // our own turn but auto-resolving (e.g. forced pass)
  else status = t('waitingFor', { name: label(state.turn) });

  return (
    <main className="table">
      <TrixScoreboard state={state} t={t} />

      {contractShown && state.contract && (
        <div className={`trump-indicator ${redContract ? '' : 'dark'}`} aria-label="contract">
          <span className={redContract ? 'red' : 'black'}>{CONTRACT_ICON[state.contract]}</span>
        </div>
      )}

      {state.phase !== 'shedding' && (
        <LastTrick trick={state.lastTrick ?? null} nameFor={label} t={t} />
      )}

      {SEATS.map((s) => (
        <TrixSeat
          key={s}
          seat={s}
          state={state}
          t={t}
          name={nameFor?.(s)}
          count={countFor?.(s)}
          justWon={reviewTrick?.winner === s}
        />
      ))}

      {state.phase === 'shedding' ? (
        <SheddingBoard state={state} />
      ) : (
        <TrixTrick state={reviewTrick ? { ...state, currentTrick: [] } : state} reviewTrick={reviewTrick} />
      )}

      <div className="status-dock">
        {status && <div className="status-banner">{status}</div>}
        {turnTimer && awaitingHuman && (
          <div className="turn-timer" key={turnTimer.token}>
            <div className="turn-timer-fill" style={{ animationDuration: `${turnTimer.limitMs}ms` }} />
          </div>
        )}
      </div>

      <div className="hand-dock">
        <TrixHand state={state} active={awaitingHuman} onPlay={onPlay} />
      </div>

      {humanContract && <ContractModal state={state} onChoose={onChooseContract} t={t} />}
      {humanDoubling && <DoubleModal state={state} onSubmit={onSetDouble} t={t} />}

      {children}
    </main>
  );
}
