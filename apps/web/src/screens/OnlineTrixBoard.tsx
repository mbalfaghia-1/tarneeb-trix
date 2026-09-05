import { useEffect } from 'react';
import {
  SEATS,
  getTrixLegalActions,
  type Card,
  type TrixContract,
  type TrixState,
} from '@tarneeb/engine';
import type { RedactedView } from '@tarneeb/room';
import { rotateTrix } from '../game/rotate';
import { turnName } from '../game/labels';
import { CONTRACT_ICON } from '../game/trixLabels';
import type { T } from '../i18n';
import { TrixScoreboard } from '../components/trix/TrixScoreboard';
import { TrixSeat } from '../components/trix/TrixSeat';
import { TrixTrick } from '../components/trix/TrixTrick';
import { SheddingBoard } from '../components/trix/SheddingBoard';
import { TrixHand } from '../components/trix/TrixHand';
import { ContractModal } from '../components/trix/ContractModal';
import { DoubleModal } from '../components/trix/DoubleModal';
import { TrixGameOverlay } from '../components/trix/TrixOverlays';

export function OnlineTrixBoard({
  view,
  submit,
  onLeave,
  t,
}: {
  view: RedactedView;
  submit: (action: unknown) => void;
  onLeave: () => void;
  t: T;
}) {
  const seat = view.seat;
  const real = view.state as TrixState;
  const state = rotateTrix(real, seat);
  const yourTurn = view.yourTurn;

  // Shedding: when the only thing we can legally do is pass (nothing playable), do it
  // automatically so the table never stalls on a stuck human.
  useEffect(() => {
    if (!yourTurn || real.phase !== 'shedding') return;
    const legal = getTrixLegalActions(real);
    if (legal.length === 1 && legal[0]!.type === 'PASS') {
      submit({ type: 'PASS', seat });
    }
  }, [real, yourTurn, seat, submit]);

  const humanContract = yourTurn && state.phase === 'contract-select';
  const humanDoubling = yourTurn && state.phase === 'doubling';
  const contractShown = state.contract && (state.phase === 'playing' || state.phase === 'shedding');
  const redContract = state.contract === 'kingOfHearts' || state.contract === 'diamonds';

  let status = '';
  if (state.phase === 'deal-over' || state.phase === 'game-over') status = '';
  else if (yourTurn)
    status =
      state.phase === 'contract-select'
        ? t('chooseContract')
        : state.phase === 'doubling'
          ? t('double_title')
          : t('yourTurn');
  else status = t('waitingFor', { name: turnName(state.turn, t) });

  return (
    <main className="table">
      <TrixScoreboard state={state} t={t} />

      {contractShown && state.contract && (
        <div className={`trump-indicator ${redContract ? '' : 'dark'}`} aria-label="contract">
          <span className={redContract ? 'red' : 'black'}>{CONTRACT_ICON[state.contract]}</span>
        </div>
      )}

      {SEATS.map((s) => (
        <TrixSeat key={s} seat={s} state={state} t={t} />
      ))}

      {state.phase === 'shedding' ? (
        <SheddingBoard state={state} />
      ) : (
        <TrixTrick state={state} reviewTrick={null} />
      )}

      <div className="status-dock">{status && <div className="status-banner">{status}</div>}</div>

      <div className="hand-dock">
        <TrixHand
          state={state}
          active={yourTurn}
          onPlay={(c: Card) => submit({ type: 'PLAY', seat, card: c })}
        />
      </div>

      {humanContract && (
        <ContractModal
          state={state}
          onChoose={(c: TrixContract) => submit({ type: 'CHOOSE_CONTRACT', seat, contract: c })}
          t={t}
        />
      )}
      {humanDoubling && (
        <DoubleModal
          state={state}
          onSubmit={(cards: Card[]) => submit({ type: 'SET_DOUBLE', seat, cards })}
          t={t}
        />
      )}

      {state.phase === 'game-over' && <TrixGameOverlay state={state} onNewGame={onLeave} t={t} />}
    </main>
  );
}
