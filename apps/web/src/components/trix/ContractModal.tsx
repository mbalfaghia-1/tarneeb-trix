import { contractsForMode, type TrixContract, type TrixState } from '@tarneeb/engine';
import { CONTRACT_ICON, contractDesc, contractName } from '../../game/trixLabels';
import type { T } from '../../i18n';

export function ContractModal({
  state,
  onChoose,
  t,
}: {
  state: TrixState;
  onChoose: (c: TrixContract) => void;
  t: T;
}) {
  const remaining = contractsForMode(state.mode).filter((c) => !state.usedContracts.includes(c));
  return (
    <div className="modal contract-modal">
      <div className="modal-title">{t('chooseContract')}</div>
      <div className="contract-list">
        {remaining.map((c) => (
          <button type="button" className="contract-btn" key={c} onClick={() => onChoose(c)}>
            <span className={`c-icon ${c === 'kingOfHearts' || c === 'diamonds' ? 'red' : ''}`}>
              {CONTRACT_ICON[c]}
            </span>
            <span className="c-text">
              <span className="c-name">{contractName(t, c)}</span>
              <span className="c-desc">{contractDesc(t, c)}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
