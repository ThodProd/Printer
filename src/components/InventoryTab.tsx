import React from 'react';
import WarehouseInventoryPanel, { WarehouseFocusRequest } from './WarehouseInventoryPanel';
import { StoreType } from '../store';

/** Вкладка «Склад»: реестр партий, история отправок и синхронизация с основной базой расходников/ремонтов. */
const InventoryTab: React.FC<{
  store: StoreType;
  warehouseFocusRequest?: WarehouseFocusRequest | null;
  onWarehouseFocusHandled?: () => void;
}> = ({ store, warehouseFocusRequest, onWarehouseFocusHandled }) => (
  <div className="h-full min-h-0 flex flex-col">
    <WarehouseInventoryPanel
      store={store}
      focusRequest={warehouseFocusRequest ?? null}
      onFocusRequestHandled={onWarehouseFocusHandled}
    />
  </div>
);

export default InventoryTab;
