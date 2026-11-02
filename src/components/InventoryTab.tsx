import React, { useMemo } from 'react';
import WarehouseInventoryPanel, { WarehouseFocusRequest } from './WarehouseInventoryPanel';
import { StoreType } from '../store';

const InventoryTab: React.FC<{ store: StoreType; attention?: 'waiting' | 'refill' | '' }> = ({
  store,
  attention = '',
}) => {
  const focusRequest = useMemo<WarehouseFocusRequest | null>(() => {
    if (!attention) return null;
    return {
      section: attention === 'refill' ? 'at_refill' : 'waiting',
      tick: Date.now(),
    };
  }, [attention]);

  return (
    <div className="h-full min-h-0 flex flex-col">
      <WarehouseInventoryPanel store={store} focusRequest={focusRequest} />
    </div>
  );
};

export default InventoryTab;
