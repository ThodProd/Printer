
import React, { useState, useRef, useEffect } from 'react';
import {
  ArrowDownCircle, ArrowUpCircle, AlertCircle, CheckCircle2, Truck, Plus, X,
  Clock, History, Printer as PrinterIcon, User, MapPin, Hash, Package, Barcode as BarcodeIcon, Wrench,
} from 'lucide-react';
import { Cartridge, STATUS_LABELS, STATUS_COLORS, HistoryEntry, Printer, RepairEntry } from '../types';
import { StoreType } from '../store';
import { buildTSPLLabel, getTemplate } from '../utils/tspl';
import { ask } from '../utils/dialogs';

const RU_TO_EN_LAYOUT: Record<string, string> = {
  й: 'q', ц: 'w', у: 'e', к: 'r', е: 't', н: 'y', г: 'u', ш: 'i', щ: 'o', з: 'p', х: '[', ъ: ']',
  ф: 'a', ы: 's', в: 'd', а: 'f', п: 'g', р: 'h', о: 'j', л: 'k', д: 'l', ж: ';', э: "'",
  я: 'z', ч: 'x', с: 'c', м: 'v', и: 'b', т: 'n', ь: 'm', б: ',', ю: '.', ё: '`',
  Й: 'Q', Ц: 'W', У: 'E', К: 'R', Е: 'T', Н: 'Y', Г: 'U', Ш: 'I', Щ: 'O', З: 'P', Х: '[', Ъ: ']',
  Ф: 'A', Ы: 'S', В: 'D', А: 'F', П: 'G', Р: 'H', О: 'J', Л: 'K', Д: 'L', Ж: ';', Э: "'",
  Я: 'Z', Ч: 'X', С: 'C', М: 'V', И: 'B', Т: 'N', Ь: 'M', Б: ',', Ю: '.', Ё: '`',
};

function normalizeScannerCode(value: string): string {
  return value.split('').map(ch => RU_TO_EN_LAYOUT[ch] ?? ch).join('');
}

interface InfoCardState {
  cartridge: Cartridge;
  printer: Printer | undefined;
  pendingAction: 'accept' | 'return' | 'receive_refill' | null;
}

interface PrinterActionState {
  printer: Printer;
  repair?: RepairEntry;
  pendingAction: 'accept' | 'return' | 'receive_refill';
}

const Dashboard: React.FC<{ store: StoreType; onNavigate?: (tab: string) => void }> = ({ store }) => {
  const [mode, setMode] = useState<'accept' | 'return' | 'receive_refill'>('accept');
  const [barcode, setBarcode] = useState('');
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [infoCard, setInfoCard] = useState<InfoCardState | null>(null);
  const [printerAction, setPrinterAction] = useState<PrinterActionState | null>(null);
  const [printerRepairForm, setPrinterRepairForm] = useState({ reason: '', owner: '', comment: '', solution: '', recipient: '', firmwareFlashed: false, includeConsumables: false, selectedConsumableIds: [] as string[] });
  const [employeeInput, setEmployeeInput] = useState('');
  const [showNewForm, setShowNewForm] = useState(false);
  const [pendingCode, setPendingCode] = useState('');
  const [newForm, setNewForm] = useState({ printerInventoryNumber: '', model: '', department: '', boss: '' });
  const [recentOps, setRecentOps] = useState<Array<{ text: string; time: string; ok: boolean }>>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!showNewForm && !infoCard && !printerAction) inputRef.current?.focus();
  }, [mode, showNewForm, infoCard, printerAction]);

  useEffect(() => {
    const onScan = (event: Event) => {
      const code = (event as CustomEvent<string>).detail;
      setBarcode(code);
      setTimeout(() => inputRef.current?.focus(), 0);
    };
    window.addEventListener('app-scanner-input', onScan as EventListener);
    return () => window.removeEventListener('app-scanner-input', onScan as EventListener);
  }, []);

  const addOp = (text: string, ok: boolean) => {
    setRecentOps(prev => [{ text, time: new Date().toLocaleTimeString(), ok }, ...prev.slice(0, 9)]);
  };

  const handleScan = (e: React.FormEvent) => {
    e.preventDefault();
    const code = normalizeScannerCode(barcode.trim());
    if (!code) return;
    setBarcode('');

    const cartridge = store.cartridges.find(c => c.barcode === code || c.id === code);

    const codeKey = code.toLocaleLowerCase('ru');
    const scannedPrinter = store.printers.find(p =>
      p.inventoryNumber.toLocaleLowerCase('ru') === codeKey || (p.programId ?? '').toLocaleLowerCase('ru') === codeKey,
    );

    if (!cartridge && scannedPrinter) {
      const printerRepairs = store.repairs
        .filter(repair => repair.printerInventoryNumber === scannedPrinter.inventoryNumber)
        .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime());
      const activeRepair = printerRepairs.find(repair => {
        if (repair.locationStatus === 'issued') return false;
        if (repair.locationStatus === 'waiting' || repair.locationStatus === 'at_refill' || repair.locationStatus === 'ready') return true;
        return repair.status === 'waiting' || repair.status === 'in_repair';
      });
      const repair = mode === 'receive_refill'
        ? printerRepairs.find(item => item.locationStatus === 'at_refill')
        : mode === 'return'
          ? printerRepairs.find(item => item.locationStatus === 'ready')
          : undefined;
      const repairLocation = activeRepair?.locationStatus === 'at_refill' ? 'склад «На заправке»'
        : activeRepair?.locationStatus === 'ready' ? 'склад «Готовы к выдаче»'
          : activeRepair ? 'склад «Ожидают отправки»' : '';

      if (mode === 'accept' && activeRepair) {
        setMessage({ text: `Принтер ${scannedPrinter.programId ?? scannedPrinter.inventoryNumber} уже находится: ${repairLocation}.`, type: 'error' });
        addOp(`Устройство уже принято: ${scannedPrinter.inventoryNumber}`, false);
        return;
      }
      if (mode !== 'accept' && !repair) {
        const detail = repairLocation ? `Сейчас он находится: ${repairLocation}.` : mode === 'receive_refill' ? 'Принтер не находится на ремонте.' : 'Принтер не готов к выдаче.';
        setMessage({ text: `${scannedPrinter.programId ?? scannedPrinter.inventoryNumber}: ${detail}`, type: 'error' });
        addOp(`Неверный статус устройства: ${scannedPrinter.inventoryNumber}`, false);
        return;
      }

      setPrinterRepairForm({
        reason: '', owner: scannedPrinter.boss || '', comment: '', solution: '',
        recipient: scannedPrinter.boss || '', firmwareFlashed: Boolean(scannedPrinter.firmwareFlashed),
        includeConsumables: false,
        selectedConsumableIds: store.cartridges.filter(cartridge => cartridge.printerInventoryNumber === scannedPrinter.inventoryNumber && !cartridge.isReplaced && (cartridge.status === 'on_hand' || cartridge.status === 'waiting')).map(cartridge => cartridge.id),
      });
      setPrinterAction({ printer: scannedPrinter, repair, pendingAction: mode });
      setMessage(null);
      return;
    }

    if (!cartridge) {
      if (mode === 'accept') {
        setPendingCode(code);
        setNewForm(f => ({ ...f, printerInventoryNumber: '' }));
        setShowNewForm(true);
        setMessage({ text: `Код «${code}» не найден — зарегистрируйте новый расходник.`, type: 'info' });
      } else {
        setMessage({ text: `Расходник «${code}» не найден в базе!`, type: 'error' });
        addOp(`Не найден: ${code}`, false);
      }
      return;
    }

    const warehouseLocation = cartridge.status === 'waiting' ? 'склад «Ожидают отправки»'
      : cartridge.status === 'at_refill' ? 'склад «На заправке»'
        : cartridge.status === 'received_from_refill' || cartridge.status === 'ready' ? 'склад «Готовы к выдаче»' : '';
    let actionError = '';
    if (mode === 'accept' && warehouseLocation) actionError = `${cartridge.id} уже находится: ${warehouseLocation}.`;
    if (mode === 'receive_refill' && cartridge.status !== 'at_refill') actionError = warehouseLocation
      ? `${cartridge.id} сейчас находится: ${warehouseLocation}. Получить его с заправки нельзя.`
      : `${cartridge.id} не находится на заправке.`;
    if (mode === 'return' && cartridge.status !== 'received_from_refill' && cartridge.status !== 'ready') actionError = warehouseLocation
      ? `${cartridge.id} сейчас находится: ${warehouseLocation}. Выдать его нельзя.`
      : cartridge.status === 'on_hand' ? `${cartridge.id} уже находится на руках.` : `${cartridge.id} недоступен для выдачи.`;
    if (actionError) {
      setMessage({ text: actionError, type: 'error' });
      addOp(actionError, false);
      setInfoCard(null);
      setTimeout(() => inputRef.current?.focus(), 50);
      return;
    }

    // Open info card first (for all modes)
    const printer = store.printers.find(p => p.inventoryNumber === cartridge.printerInventoryNumber);
    setInfoCard({ cartridge, printer, pendingAction: mode });
    setEmployeeInput(cartridge.lastSubmittedBy ?? '');
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const closePrinterAction = () => {
    setPrinterAction(null);
    setPrinterRepairForm({ reason: '', owner: '', comment: '', solution: '', recipient: '', firmwareFlashed: false, includeConsumables: false, selectedConsumableIds: [] });
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const executePrinterAction = (event: React.FormEvent) => {
    event.preventDefault();
    if (!printerAction) return;
    const { printer, repair, pendingAction } = printerAction;
    const deviceId = printer.programId ?? printer.inventoryNumber;

    if (pendingAction === 'accept') {
      const newRepair: RepairEntry = {
        id: crypto.randomUUID(),
        printerInventoryNumber: printer.inventoryNumber,
        date: new Date().toISOString(),
        reason: printerRepairForm.reason.trim(),
        status: 'waiting',
        locationStatus: 'waiting',
        technician: printerRepairForm.owner.trim() || undefined,
        comment: printerRepairForm.comment.trim() || undefined,
      };
      store.addRepair(newRepair);
      if (printerRepairForm.includeConsumables) {
        store.linkConsumablesToRepair(newRepair.id, printer.inventoryNumber, printerRepairForm.selectedConsumableIds, printerRepairForm.owner.trim() || undefined);
      }
      setMessage({ text: `✓ Принтер ${deviceId} принят и ожидает отправки в ремонт.`, type: 'success' });
      addOp(`Принят в ремонт: ${deviceId}`, true);
      closePrinterAction();
      return;
    }

    if (!repair) return;
    if (pendingAction === 'receive_refill') {
      const solution = printerRepairForm.solution.trim();
      store.completeRepairWorkflow(repair.id, solution, printerRepairForm.firmwareFlashed);
      setMessage({ text: `✓ Принтер ${deviceId} получен с ремонта и готов к выдаче.`, type: 'success' });
      addOp(`Получен с ремонта: ${deviceId}`, true);
      closePrinterAction();
      return;
    }

    const recipient = printerRepairForm.recipient.trim() || 'Сотрудник';
    const linkedIds = [deviceId, ...store.warehouseLedger.items.filter(item => item.parentDeviceId === deviceId).map(item => item.id)];
    const batchId = store.warehouseLedger.shipmentBatches.find(batch => batch.items.some(item => item.repairId === repair.id || item.id === deviceId))?.id ?? 'Быстрая выдача';
    store.finishIssuePrinterBundleFromBatch(printer.inventoryNumber, repair.id, batchId, recipient);
    store.applyWarehouseIssueSnapshotFromDashboard(linkedIds, recipient);
    if (!store.employees.some(employee => employee.name === recipient && employee.printerInventoryNumber === printer.inventoryNumber)) {
      store.addEmployee({ id: crypto.randomUUID(), name: recipient, printerInventoryNumber: printer.inventoryNumber, addedDate: new Date().toISOString() });
    }
    setMessage({ text: `✓ Принтер ${deviceId} выдан: ${recipient}.`, type: 'success' });
    addOp(`Выдан принтер: ${deviceId} (${recipient})`, true);
    closePrinterAction();
  };

  const executeAction = () => {
    if (!infoCard) return;
    const { cartridge, pendingAction } = infoCard;
    const employee = employeeInput.trim() || undefined;

    if (pendingAction === 'accept') {
      if (cartridge.status === 'waiting') {
        setMessage({ text: `${cartridge.id} уже на складе ожидания!`, type: 'error' });
        addOp(`Уже ожидает: ${cartridge.id}`, false);
      } else if (cartridge.status === 'at_refill') {
        setMessage({ text: `${cartridge.id} на заправке — используйте режим «Прием с заправки».`, type: 'error' });
        addOp(`На заправке: ${cartridge.id}`, false);
      } else {
        store.updateCartridgeStatus(cartridge.id, 'waiting', 'Принят на склад (сдан на заправку)', employee);

        // Save employee record if provided
        if (employee) {
          const existingEmployee = store.employees.find(
            e => e.name === employee && e.printerInventoryNumber === cartridge.printerInventoryNumber,
          );
          if (!existingEmployee) {
            store.addEmployee({
              id: Math.random().toString(36).substr(2, 9),
              name: employee,
              printerInventoryNumber: cartridge.printerInventoryNumber,
              cartridgeId: cartridge.id,
              addedDate: new Date().toISOString(),
            });
          }
        }

        setMessage({ text: `✓ Принят на склад: ${cartridge.id}`, type: 'success' });
        addOp(`Принят: ${cartridge.id}${employee ? ` (${employee})` : ''}`, true);
      }
    } else if (pendingAction === 'receive_refill') {
      if (cartridge.status !== 'at_refill') {
        setMessage({ text: `${cartridge.id} не на заправке (статус: ${STATUS_LABELS[cartridge.status]}).`, type: 'error' });
        addOp(`Не на заправке: ${cartridge.id}`, false);
      } else {
        store.updateCartridgeStatus(cartridge.id, 'received_from_refill', 'Принят с заправки');
        store.applyWarehouseReceiveForCartridgeFromDashboard(cartridge.id);
        setMessage({ text: `✓ Принят с заправки: ${cartridge.id}`, type: 'success' });
        addOp(`Получен с заправки: ${cartridge.id}`, true);
      }
    } else if (pendingAction === 'return') {
      if (cartridge.status === 'received_from_refill' || cartridge.status === 'ready') {
        store.updateCartridgeStatus(cartridge.id, 'on_hand', 'Выдан пользователю', employee);
        store.applyWarehouseIssueSnapshotFromDashboard([cartridge.id], employee ?? 'Сотрудник');
        if (employee) {
          const existingEmployee = store.employees.find(
            e => e.name === employee && e.printerInventoryNumber === cartridge.printerInventoryNumber,
          );
          if (!existingEmployee) {
            store.addEmployee({
              id: Math.random().toString(36).substr(2, 9),
              name: employee,
              printerInventoryNumber: cartridge.printerInventoryNumber,
              cartridgeId: cartridge.id,
              addedDate: new Date().toISOString(),
            });
          }
        }
        setMessage({ text: `✓ Выдан: ${cartridge.id}`, type: 'success' });
        addOp(`Выдан: ${cartridge.id}${employee ? ` (${employee})` : ''}`, true);
      } else if (cartridge.status === 'on_hand') {
        setMessage({ text: `${cartridge.id} уже на руках.`, type: 'error' });
        addOp(`Уже на руках: ${cartridge.id}`, false);
      } else {
        setMessage({ text: `Нельзя выдать — статус: ${STATUS_LABELS[cartridge.status]}.`, type: 'error' });
        addOp(`Нельзя выдать: ${cartridge.id}`, false);
      }
    }

    setInfoCard(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleRegisterNew = (e: React.FormEvent) => {
    e.preventDefault();
    const id = store.generateConsumableId('cartridge');
    const now = new Date().toISOString();

    const printerExists = store.printers.find(p => p.inventoryNumber === newForm.printerInventoryNumber);
    if (!printerExists && newForm.printerInventoryNumber) {
      store.addPrinter({
        inventoryNumber: newForm.printerInventoryNumber,
        model: 'Неизвестная модель',
        printerType: 'printer',
        department: newForm.department || '',
        boss: newForm.boss || '',
        cartridgeModels: [newForm.model].filter(Boolean),
        commissionDate: '',
        balanceCost: '',
      });
    }

    const histEntry: HistoryEntry = {
      id: Math.random().toString(36).substr(2, 9),
      date: now,
      action: 'Зарегистрирован. Принят на склад ожидания.',
    };

    const cartridge: Cartridge = {
      id,
      barcode: id,
      model: newForm.model,
      consumableType: 'cartridge',
      printerInventoryNumber: newForm.printerInventoryNumber,
      status: 'waiting',
      history: [histEntry],
      isReplaced: false,
      refillCount: 1,
      registrationDate: now,
      labelPrinted: false,
    };

    store.addCartridge(cartridge);

    // Auto print if enabled
    if (store.settings.autoPrintOnRegister && store.settings.labelPrinterName && window.desktopAPI) {
      const tspl = buildTSPLLabel(getTemplate(store.settings), store.settings, {
        id,
        inv: newForm.printerInventoryNumber,
        cartModel: newForm.model,
        printerModel: printerExists?.model ?? 'Неизвестная модель',
        fio: newForm.boss || printerExists?.boss || '',
        boss: newForm.boss || printerExists?.boss || '',
        department: newForm.department || printerExists?.department || '',
        printerType: printerExists?.printerType ?? 'printer',
        commissionDate: printerExists?.commissionDate ?? '',
        balanceCost: printerExists?.balanceCost ?? '',
        consumableType: 'Картридж',
        status: STATUS_LABELS.waiting,
      });
      void window.desktopAPI.rawPrint(store.settings.labelPrinterName, tspl, store.settings.labelPrintMode).then(result => {
        if (result.success) store.updateCartridge(id, { labelPrinted: true });
        store.recordAction({
          category: 'cartridge', entityId: id, cartridgeId: id, cartridgeModel: newForm.model,
          printerInventoryNumber: newForm.printerInventoryNumber,
          action: result.success ? 'Автоматически напечатана этикетка расходника' : 'Ошибка автоматической печати этикетки', details: result.error,
        });
      });
    }

    setMessage({ text: `✓ Зарегистрирован: ${id}. Напечатайте этикетку!`, type: 'success' });
    addOp(`Зарегистрирован: ${id}`, true);
    setShowNewForm(false);
    setNewForm({ printerInventoryNumber: '', model: '', department: '', boss: '' });
    setPendingCode('');
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const modeConfig = {
    accept: {
      color: 'blue',
      label: 'Принять на склад',
      hint: 'Сотрудник сдаёт картридж на заправку',
      icon: <ArrowDownCircle size={28} />,
      placeholder: 'Сканируйте штрих-код картриджа',
    },
    receive_refill: {
      color: 'purple',
      label: 'Получить с заправки',
      hint: 'Пришли заправленные картриджи',
      icon: <Truck size={28} />,
      placeholder: 'Сканируйте картридж, пришедший с заправки',
    },
    return: {
      color: 'green',
      label: 'Выдать',
      hint: 'Выдача картриджа сотруднику',
      icon: <ArrowUpCircle size={28} />,
      placeholder: 'Сканируйте картридж для выдачи',
    },
  };
  const mc = modeConfig[mode];

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Mode buttons */}
      <div className="grid grid-cols-3 gap-4">
        {(Object.entries(modeConfig) as [typeof mode, (typeof modeConfig)[typeof mode]][]).map(([id, cfg]) => (
          <button
            key={id}
            onClick={() => { setMode(id as typeof mode); setMessage(null); }}
            className={`p-4 rounded-xl border-2 flex flex-col items-center space-y-1.5 transition-all ${
              mode === id
                ? id === 'accept'   ? 'border-blue-500 bg-blue-50 text-blue-700'
                : id === 'receive_refill' ? 'border-purple-500 bg-purple-50 text-purple-700'
                :                    'border-green-500 bg-green-50 text-green-700'
                : 'border-gray-200 bg-white text-gray-400 hover:border-gray-300'
            }`}
          >
            {cfg.icon}
            <span className="text-sm font-bold uppercase">{cfg.label}</span>
            <p className="text-xs opacity-70 text-center">{cfg.hint}</p>
          </button>
        ))}
      </div>

      {/* Scan input */}
      <div className="bg-white p-6 rounded-xl shadow-sm border">
        <form onSubmit={handleScan} className="flex flex-col items-center space-y-3">
          <label className="text-sm font-medium text-gray-600">{mc.placeholder}</label>
          <input data-scanner="true"
            ref={inputRef}
            type="text"
            value={barcode}
            onChange={e => setBarcode(e.target.value)}
            className="w-full max-w-lg text-3xl text-center tracking-widest p-4 border-2 border-gray-300 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none font-mono"
            placeholder="||||||||||||||||"
            autoFocus
          />
          <button type="submit" className="sr-only">Обработать</button>
        </form>

        {message && (
          <div role="status" className={`mt-5 p-4 rounded-lg flex items-center space-x-3 ${
            message.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' :
            message.type === 'info'    ? 'bg-blue-50 text-blue-800 border border-blue-200' :
                                         'bg-red-50 text-red-800 border border-red-200'
          }`}>
            {message.type === 'success' ? <CheckCircle2 size={20} /> :
             message.type === 'info'    ? <Plus size={20} /> :
                                          <AlertCircle size={20} />}
            <span className="text-sm font-semibold">{message.text}</span>
          </div>
        )}
      </div>

      {/* Printer workflow modal — the same quick scanner handles devices by program ID or inventory number. */}
      {printerAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className={`flex items-center justify-between px-6 py-4 text-white ${
              printerAction.pendingAction === 'accept' ? 'bg-blue-600' :
              printerAction.pendingAction === 'receive_refill' ? 'bg-purple-600' : 'bg-green-600'
            }`}>
              <div className="flex items-center gap-3">
                <Wrench size={22} />
                <div>
                  <h2 className="text-lg font-bold">{
                    printerAction.pendingAction === 'accept' ? 'Принять принтер в ремонт' :
                    printerAction.pendingAction === 'receive_refill' ? 'Получить принтер с ремонта' : 'Выдать принтер'
                  }</h2>
                  <p className="text-xs opacity-80">{printerAction.printer.programId ?? printerAction.printer.inventoryNumber} · {printerAction.printer.model}</p>
                </div>
              </div>
              <button type="button" aria-label="Закрыть окно принтера" onClick={closePrinterAction} className="opacity-75 hover:opacity-100"><X size={20} /></button>
            </div>

            <form onSubmit={executePrinterAction} className="space-y-4 p-6">
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-sm">
                <div className="flex justify-between gap-3"><span className="text-gray-500">Инвентарный номер</span><strong className="font-mono">{printerAction.printer.inventoryNumber}</strong></div>
                <div className="mt-1 flex justify-between gap-3"><span className="text-gray-500">Подразделение</span><strong className="text-right">{printerAction.printer.department || '—'}</strong></div>
                {printerAction.repair && <div className="mt-2 border-t border-gray-200 pt-2"><span className="text-gray-500">Причина ремонта: </span><strong>{printerAction.repair.reason}</strong></div>}
              </div>

              {printerAction.pendingAction === 'accept' && <>
                <div><label className="mb-1 block text-xs text-gray-500">Причина / описание неисправности *</label><textarea required autoFocus value={printerRepairForm.reason} onChange={event => setPrinterRepairForm(current => ({ ...current, reason: event.target.value }))} className="h-24 w-full resize-none rounded-lg border p-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500" placeholder="Опишите неисправность…" /></div>
                <div><label className="mb-1 block text-xs text-gray-500">Кто сдал / чей принтер</label><input value={printerRepairForm.owner} onChange={event => setPrinterRepairForm(current => ({ ...current, owner: event.target.value }))} className="w-full rounded-lg border p-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500" placeholder="ФИО" /></div>
                <div><label className="mb-1 block text-xs text-gray-500">Комментарий</label><input value={printerRepairForm.comment} onChange={event => setPrinterRepairForm(current => ({ ...current, comment: event.target.value }))} className="w-full rounded-lg border p-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500" placeholder="Дополнительно (необязательно)" /></div>
                <label className={`flex cursor-pointer items-start gap-2 rounded-xl border p-3 ${printerRepairForm.includeConsumables ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-gray-50/60'}`}><input type="checkbox" checked={printerRepairForm.includeConsumables} onChange={event => setPrinterRepairForm(current => ({ ...current, includeConsumables: event.target.checked }))} className="mt-0.5 h-4 w-4 rounded accent-blue-600" /><span><span className="block text-sm font-semibold text-gray-700">Отправить расходники вместе с принтером</span><span className="block text-[10px] text-gray-400">Картриджи и драмы будут проходить все склады вместе с устройством</span></span></label>
                {printerRepairForm.includeConsumables && <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-2">
                  {store.cartridges.filter(cartridge => printerRepairForm.selectedConsumableIds.includes(cartridge.id) || (cartridge.printerInventoryNumber === printerAction.printer.inventoryNumber && !cartridge.isReplaced && (cartridge.status === 'on_hand' || cartridge.status === 'waiting'))).map(cartridge => <label key={cartridge.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-gray-50"><input type="checkbox" checked={printerRepairForm.selectedConsumableIds.includes(cartridge.id)} onChange={() => setPrinterRepairForm(current => ({ ...current, selectedConsumableIds: current.selectedConsumableIds.includes(cartridge.id) ? current.selectedConsumableIds.filter(id => id !== cartridge.id) : [...current.selectedConsumableIds, cartridge.id] }))} className="h-3.5 w-3.5 rounded accent-blue-600" /><span className="font-mono font-bold text-blue-700">{cartridge.id}</span><span className="text-gray-600">{cartridge.consumableType === 'drum' ? 'Драм' : 'Картридж'} · {cartridge.model}</span></label>)}
                  {printerRepairForm.selectedConsumableIds.length === 0 && <div className="p-2 text-center text-xs italic text-gray-400">Нет доступных расходников</div>}
                </div>}
              </>}

              {printerAction.pendingAction === 'receive_refill' && <>
                <div><label className="mb-1 block text-xs text-gray-500">Результат ремонта / что сделано *</label><textarea required autoFocus value={printerRepairForm.solution} onChange={event => setPrinterRepairForm(current => ({ ...current, solution: event.target.value }))} className="h-24 w-full resize-none rounded-lg border p-2.5 text-sm outline-none focus:ring-2 focus:ring-purple-500" placeholder="Опишите выполненные работы…" /></div>
                <label className={`flex items-start gap-2 rounded-xl border p-3 ${printerAction.printer.firmwareFlashed ? 'border-gray-200 bg-gray-50 text-gray-400' : 'cursor-pointer border-purple-200 bg-purple-50 text-gray-700'}`}>
                  <input type="checkbox" checked={printerRepairForm.firmwareFlashed} disabled={Boolean(printerAction.printer.firmwareFlashed)} onChange={event => setPrinterRepairForm(current => ({ ...current, firmwareFlashed: event.target.checked }))} className="mt-0.5 h-4 w-4 accent-purple-600" />
                  <span><span className="block text-sm font-semibold">Принтер прошит</span>{printerAction.printer.firmwareFlashed && <span className="block text-[10px]">Отметка уже установлена</span>}</span>
                </label>
              </>}

              {printerAction.pendingAction === 'return' && <div><label className="mb-1 block text-xs text-gray-500">Кому выдать</label><input autoFocus value={printerRepairForm.recipient} onChange={event => setPrinterRepairForm(current => ({ ...current, recipient: event.target.value }))} className="w-full rounded-lg border p-2.5 text-sm outline-none focus:ring-2 focus:ring-green-500" placeholder="ФИО получателя" /></div>}

              <div className="flex gap-2 pt-1">
                <button type="button" onClick={closePrinterAction} className="flex-1 rounded-lg border py-2.5 text-sm hover:bg-gray-50">Отмена</button>
                <button type="submit" className={`flex-1 rounded-lg py-2.5 text-sm font-bold text-white ${printerAction.pendingAction === 'accept' ? 'bg-blue-600 hover:bg-blue-700' : printerAction.pendingAction === 'receive_refill' ? 'bg-purple-600 hover:bg-purple-700' : 'bg-green-600 hover:bg-green-700'}`}>{printerAction.pendingAction === 'accept' ? 'Оформить ремонт' : printerAction.pendingAction === 'receive_refill' ? 'Принять с ремонта' : 'Выдать принтер'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Info Card Modal — opens on scan */}
      {infoCard && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden">
            {/* Header */}
            <div className={`px-6 py-4 flex items-center justify-between ${
              infoCard.pendingAction === 'accept' ? 'bg-blue-600' :
              infoCard.pendingAction === 'receive_refill' ? 'bg-purple-600' :
              'bg-green-600'
            } text-white`}>
              <div className="flex items-center space-x-3">
                <Package size={22} />
                <div>
                  <div className="font-bold text-lg">{infoCard.cartridge.id}</div>
                  <div className="text-sm opacity-80">
                    {infoCard.cartridge.consumableType === 'drum' ? 'Драм-картридж' : 'Картридж'} · {infoCard.cartridge.model}
                  </div>
                </div>
              </div>
              <button onClick={() => { setInfoCard(null); setTimeout(() => inputRef.current?.focus(), 50); }}
                className="opacity-70 hover:opacity-100"><X size={20} /></button>
            </div>

            <div className="p-6 space-y-4">
              {/* Printer info */}
              {infoCard.printer && (
                <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                  <div className="text-xs font-bold text-gray-400 uppercase mb-2 flex items-center space-x-1">
                    <PrinterIcon size={12} />
                    <span>Принтер</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-bold">{infoCard.printer.inventoryNumber}</div>
                      <div className="text-sm text-gray-500">{infoCard.printer.model}</div>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                      infoCard.printer.printerType === 'mfu' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                    }`}>
                      {infoCard.printer.printerType === 'mfu' ? 'МФУ' : 'Принтер'}
                    </span>
                  </div>
                  {infoCard.printer.department && (
                    <div className="flex items-center space-x-1 text-sm text-gray-600">
                      <MapPin size={12} className="text-gray-400" />
                      <span>{infoCard.printer.department}</span>
                    </div>
                  )}
                  {infoCard.printer.boss && (
                    <div className="flex items-center space-x-1 text-sm text-gray-600">
                      <Hash size={12} className="text-gray-400" />
                      <span>{infoCard.printer.boss}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Cartridge info */}
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xl font-bold text-blue-700">{infoCard.cartridge.refillCount}</div>
                  <div className="text-xs text-gray-500">Заправок</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className={`text-xs font-bold px-1.5 py-1 rounded ${STATUS_COLORS[infoCard.cartridge.status]}`}>
                    {STATUS_LABELS[infoCard.cartridge.status]}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">Статус</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs font-bold text-gray-700">
                    {new Date(infoCard.cartridge.registrationDate).toLocaleDateString('ru-RU')}
                  </div>
                  <div className="text-xs text-gray-500">Зарегистрирован</div>
                </div>
              </div>

              {/* Last submitted by */}
              {infoCard.cartridge.lastSubmittedBy && (
                <div className="flex items-center space-x-2 text-sm text-gray-600 bg-blue-50 rounded-lg px-3 py-2">
                  <User size={14} className="text-blue-500" />
                  <span>Последний сдал: <strong>{infoCard.cartridge.lastSubmittedBy}</strong></span>
                </div>
              )}

              {/* Employee input for accept/return modes */}
              {(infoCard.pendingAction === 'accept' || infoCard.pendingAction === 'return') && (
                <div>
                  <label className="text-xs text-gray-500 block mb-1">
                    {infoCard.pendingAction === 'accept'
                      ? 'ФИО сотрудника, который сдаёт (необязательно)'
                      : 'Кто забирает заправленный картридж (необязательно)'}
                  </label>
                  <input
                    type="text"
                    value={employeeInput}
                    onChange={e => setEmployeeInput(e.target.value)}
                    list="emp-suggest"
                    placeholder={infoCard.pendingAction === 'accept' ? 'Петров П.П.' : 'Иванов И.И.'}
                    className="w-full p-2.5 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                  <datalist id="emp-suggest">
                    {store.getEmployeesForPrinter(infoCard.cartridge.printerInventoryNumber).map(e => (
                      <option key={e.id} value={e.name} />
                    ))}
                    {store.getEmployeesForCartridge(infoCard.cartridge.id).map(e => (
                      <option key={e.id} value={e.name} />
                    ))}
                  </datalist>
                </div>
              )}

              {/* Recent history */}
              {infoCard.cartridge.history.length > 0 && (
                <div>
                  <div className="text-xs font-bold text-gray-400 uppercase mb-2">История (последние 3)</div>
                  <div className="space-y-1">
                    {infoCard.cartridge.history.slice(-3).reverse().map(h => (
                      <div key={h.id} className="flex justify-between text-xs text-gray-600 bg-gray-50 rounded px-2 py-1.5">
                        <span>{h.action}{h.employee ? ` · ${h.employee}` : ''}</span>
                        <span className="text-gray-400 shrink-0 ml-2">{new Date(h.date).toLocaleDateString('ru-RU')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex space-x-3 pt-1">
                <button
                  onClick={() => { setInfoCard(null); setTimeout(() => inputRef.current?.focus(), 50); }}
                  className="flex-1 py-2.5 border rounded-xl text-sm hover:bg-gray-50"
                >
                  Отмена
                </button>
                <button
                  onClick={executeAction}
                  className={`flex-2 flex-1 py-2.5 rounded-xl text-sm font-bold text-white flex items-center justify-center space-x-2 ${
                    infoCard.pendingAction === 'accept' ? 'bg-blue-600 hover:bg-blue-700' :
                    infoCard.pendingAction === 'receive_refill' ? 'bg-purple-600 hover:bg-purple-700' :
                    'bg-green-600 hover:bg-green-700'
                  }`}
                >
                  <CheckCircle2 size={16} />
                  <span>
                    {infoCard.pendingAction === 'accept' ? 'Подтвердить приём на склад' :
                     infoCard.pendingAction === 'receive_refill' ? 'Принять с заправки' :
                     'Выдать сотруднику'}
                  </span>
                </button>
              </div>

              {infoCard.cartridge && (
                <label className="mb-3 flex cursor-pointer select-none items-center gap-2 rounded-xl border bg-gray-50 p-2.5 text-xs">
                  <input
                    type="checkbox"
                    aria-label={`Этикетка напечатана ${infoCard.cartridge.id}`}
                    className="h-4 w-4 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    checked={Boolean(infoCard.cartridge.labelPrinted)}
                    onChange={event => {
                      store.updateCartridge(infoCard.cartridge.id, { labelPrinted: event.target.checked });
                      setInfoCard({ ...infoCard, cartridge: { ...infoCard.cartridge, labelPrinted: event.target.checked } });
                    }}
                  />
                  <span className="font-semibold text-gray-700">Этикетка на этот расходник уже напечатана</span>
                </label>
              )}

              {/* Print label shortcut */}
              {infoCard.cartridge && (
                <button
                  onClick={async () => {
                    if (infoCard.cartridge.labelPrinted && !await ask(`Внимание! Этикетка на расходник ${infoCard.cartridge.id} уже была напечатана. Напечатать повторно?`)) return;
                    if (!store.settings.labelPrinterName || !window.desktopAPI) return;
                    const printer = store.printers.find(p => p.inventoryNumber === infoCard.cartridge.printerInventoryNumber);
                    const tspl = buildTSPLLabel(getTemplate(store.settings), store.settings, {
                      id: infoCard.cartridge.id,
                      inv: infoCard.cartridge.printerInventoryNumber,
                      cartModel: infoCard.cartridge.model,
                      printerModel: printer?.model ?? '',
                      fio: printer?.boss ?? '',
                      boss: printer?.boss ?? '',
                      department: printer?.department ?? '',
                      printerType: printer?.printerType ?? '',
                      commissionDate: printer?.commissionDate ?? '',
                      balanceCost: printer?.balanceCost ?? '',
                      consumableType: infoCard.cartridge.consumableType === 'drum' ? 'Драм-картридж' : 'Картридж',
                      status: STATUS_LABELS[infoCard.cartridge.status],
                    });
                    const result = await window.desktopAPI.rawPrint(store.settings.labelPrinterName, tspl, store.settings.labelPrintMode);
                    if (result.success) {
                      store.updateCartridge(infoCard.cartridge.id, { labelPrinted: true });
                      setInfoCard({ ...infoCard, cartridge: { ...infoCard.cartridge, labelPrinted: true } });
                    }
                    store.recordAction({
                      category: 'cartridge', entityId: infoCard.cartridge.id,
                      cartridgeId: infoCard.cartridge.id, cartridgeModel: infoCard.cartridge.model,
                      printerInventoryNumber: infoCard.cartridge.printerInventoryNumber,
                      action: result.success ? 'Напечатана этикетка расходника' : 'Ошибка печати этикетки расходника', details: result.error,
                    });
                  }}
                  disabled={!store.settings.labelPrinterName || !window.desktopAPI}
                  className="w-full py-2 border border-blue-200 text-blue-600 rounded-xl text-xs font-semibold hover:bg-blue-50 flex items-center justify-center space-x-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <BarcodeIcon size={13} />
                  <span>Напечатать этикетку</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Register New Cartridge Modal */}
      {showNewForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold">Новый расходник</h2>
              <button onClick={() => setShowNewForm(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            {pendingCode && (
              <div className="mb-3 p-2 bg-blue-50 text-blue-700 rounded text-xs font-mono">
                Код: <strong>{pendingCode}</strong>
              </div>
            )}
            <form onSubmit={handleRegisterNew} className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Инв. № принтера *</label>
                <input required list="printer-inv-list2"
                  value={newForm.printerInventoryNumber}
                  onChange={e => setNewForm({ ...newForm, printerInventoryNumber: e.target.value })}
                  placeholder="INV-0001"
                  className="w-full p-2.5 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                <datalist id="printer-inv-list2">
                  {store.printers.map(p => <option key={p.inventoryNumber} value={p.inventoryNumber}>{p.model}</option>)}
                </datalist>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Модель картриджа *</label>
                <input required
                  value={newForm.model}
                  onChange={e => setNewForm({ ...newForm, model: e.target.value })}
                  placeholder="CF283A"
                  list="cart-model-list2"
                  className="w-full p-2.5 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                <datalist id="cart-model-list2">
                  {(() => {
                    const pr = store.printers.find(p => p.inventoryNumber === newForm.printerInventoryNumber);
                    return (pr?.cartridgeModels ?? []).map(m => <option key={m} value={m} />);
                  })()}
                </datalist>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Подразделение</label>
                <input value={newForm.department}
                  onChange={e => setNewForm({ ...newForm, department: e.target.value })}
                  placeholder="Бухгалтерия"
                  className="w-full p-2.5 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Мат. ответственный</label>
                <input value={newForm.boss}
                  onChange={e => setNewForm({ ...newForm, boss: e.target.value })}
                  placeholder="Иванов И.И."
                  className="w-full p-2.5 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div className="flex space-x-2 pt-1">
                <button type="button" onClick={() => setShowNewForm(false)}
                  className="flex-1 py-2.5 border rounded-lg text-sm hover:bg-gray-50">Отмена</button>
                <button type="submit"
                  className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 flex items-center justify-center space-x-2">
                  <Plus size={15} /><span>Зарегистрировать</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Recent ops */}
      {recentOps.length > 0 && (
        <div className="bg-white rounded-xl border p-4">
          <h3 className="text-xs font-bold text-gray-400 uppercase mb-3 flex items-center space-x-2">
            <History size={14} />
            <span>Последние операции</span>
          </h3>
          <div className="space-y-1">
            {recentOps.map((op, i) => (
              <div key={i} className={`flex justify-between items-center text-xs py-1.5 px-3 rounded ${op.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                <span>{op.text}</span>
                <span className="opacity-60 flex items-center space-x-1 shrink-0 ml-2">
                  <Clock size={11} />
                  <span>{op.time}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
