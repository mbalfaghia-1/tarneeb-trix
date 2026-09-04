import { MAX_BID, MIN_BID, minLegalBid, type TarneebState } from '@tarneeb/engine';
import type { T } from '../i18n';

export function BiddingModal({
  state,
  onBid,
  onPass,
  t,
}: {
  state: TarneebState;
  onBid: (n: number) => void;
  onPass: () => void;
  t: T;
}) {
  const min = minLegalBid(state.highBid?.amount ?? null);
  const amounts: number[] = [];
  for (let a = MIN_BID; a <= MAX_BID; a++) amounts.push(a);

  return (
    <div className="modal bidding-modal">
      <div className="modal-title">{t('selectBid')}</div>
      <div className="bid-grid">
        {amounts.map((a) => (
          <button
            key={a}
            type="button"
            className={`bid-btn ${a < min ? 'disabled' : ''}`}
            disabled={a < min}
            onClick={() => onBid(a)}
          >
            {a}
          </button>
        ))}
      </div>
      <button type="button" className="pass-btn" onClick={onPass}>
        {t('pass')}
      </button>
    </div>
  );
}
