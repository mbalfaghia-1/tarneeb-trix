import { useTarneebGame } from '../game/useTarneebGame';
import { useGameSounds } from '../lib/useGameSounds';
import type { T } from '../i18n';
import { TarneebBoard } from '../components/TarneebBoard';
import { GameOverOverlay, HandOverOverlay } from '../components/Overlays';

export function TarneebScreen({ t }: { t: T }) {
  const game = useTarneebGame();
  const { state } = game;
  useGameSounds(game);

  return (
    <TarneebBoard
      state={state}
      t={t}
      awaitingHuman={game.awaitingHuman}
      reviewTrick={game.reviewTrick}
      onBid={game.bid}
      onPass={game.pass}
      onSelectTrump={game.selectTrump}
      onPlay={game.playCard}
      turnTimer={{ limitMs: game.turnLimitMs, token: game.turnToken }}
      claim={{ canClaim: game.canClaim, onClaim: game.claim }}
    >
      {state.phase === 'hand-over' && !game.reviewTrick && (
        <HandOverOverlay state={state} onNext={game.nextHand} t={t} />
      )}
      {state.phase === 'game-over' && !game.reviewTrick && (
        <GameOverOverlay state={state} onNewGame={game.newGame} t={t} />
      )}
    </TarneebBoard>
  );
}
