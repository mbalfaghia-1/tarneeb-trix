import { type TrixMode } from '@tarneeb/engine';
import { useTrixGame } from '../game/useTrixGame';
import { useTrixSounds } from '../lib/useTrixSounds';
import { useRecordOutcome } from '../game/useRecordOutcome';
import type { T } from '../i18n';
import { TrixBoard } from '../components/trix/TrixBoard';
import { TrixDealOverlay, TrixGameOverlay } from '../components/trix/TrixOverlays';

export function TrixScreen({
  t,
  mode = 'regular',
  partnership = false,
}: {
  t: T;
  mode?: TrixMode;
  partnership?: boolean;
}) {
  const game = useTrixGame(mode, partnership);
  const { state } = game;
  useTrixSounds(game);
  useRecordOutcome(mode === 'complex' ? 'trixComplex' : 'trix', state.phase, state.winner);

  return (
    <TrixBoard
      state={state}
      t={t}
      awaitingHuman={game.awaitingHuman}
      reviewTrick={game.reviewTrick}
      onChooseContract={game.chooseContract}
      onSetDouble={game.setDouble}
      onPlay={game.playCard}
      turnTimer={{ limitMs: game.turnLimitMs, token: game.turnToken }}
    >
      {state.phase === 'deal-over' && !game.reviewTrick && (
        <TrixDealOverlay state={state} onNext={game.nextDeal} t={t} />
      )}
      {state.phase === 'game-over' && (
        <TrixGameOverlay state={state} onNewGame={game.newGame} t={t} />
      )}
    </TrixBoard>
  );
}
