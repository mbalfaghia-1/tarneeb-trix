import { RANK_LABEL, SUIT_IS_RED, SUIT_SYMBOL, type Card } from '@tarneeb/engine';

interface Props {
  card?: Card;
  faceDown?: boolean;
  size?: 'sm' | 'md' | 'lg';
  playable?: boolean;
  dimmed?: boolean;
  onClick?: () => void;
}

export function CardView({ card, faceDown, size = 'md', playable, dimmed, onClick }: Props) {
  if (faceDown || !card) {
    return <div className={`card back ${size}`} aria-hidden="true" />;
  }
  const red = SUIT_IS_RED[card.suit];
  const cls = [
    'card',
    size,
    red ? 'red' : 'black',
    playable ? 'playable' : '',
    dimmed ? 'dimmed' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type="button"
      className={cls}
      onClick={playable ? onClick : undefined}
      disabled={!playable}
      aria-label={`${RANK_LABEL[card.rank]} ${card.suit}`}
    >
      <span className="corner tl">
        <span className="rank">{RANK_LABEL[card.rank]}</span>
        <span className="suit">{SUIT_SYMBOL[card.suit]}</span>
      </span>
      <span className="pip">{SUIT_SYMBOL[card.suit]}</span>
      <span className="corner br">
        <span className="rank">{RANK_LABEL[card.rank]}</span>
        <span className="suit">{SUIT_SYMBOL[card.suit]}</span>
      </span>
    </button>
  );
}
