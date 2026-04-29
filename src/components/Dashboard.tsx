
import React, { useState, useRef, useEffect } from 'react';
import {
  ArrowDownCircle, ArrowUpCircle, AlertCircle, CheckCircle2, Truck, Plus, X,
  Clock, History, Printer as PrinterIcon, User, MapPin, Hash, Package, Barcode as BarcodeIcon,
} from 'lucide-react';
import { Cartridge, STATUS_LABELS, STATUS_COLORS, HistoryEntry, Printer } from '../types';
import { StoreType } from '../store';
import { buildTSPLLabel, getTemplate } from '../utils/tspl';

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

interface PrinterIntakeState {
  printer: Printer;
  reason: string;
  technician: string;
  includeCartridges: boolean;
  selectedCartridgeIds: string[];
}

interface PrinterReturnState {
  repairId: string;
  printer: Printer;
  employee: string;
}

const Dashboard: React.FC<{ store: StoreType; onNavigate?: (tab: string) => void }> = ({ store }) => {
  const [mode, setMode] = useState<'accept' | 'return' | 'receive_refill'>('accept');
  const [barcode, setBarcode] = useState('');
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [infoCard, setInfoCard] = useState<InfoCardState | null>(null);
  const [employeeInput, setEmployeeInput] = useState('');
  const [showNewForm, setShowNewForm] = useState(false);
  const [pendingCode, setPendingCode] = useState('');
  const [newForm, setNewForm] = useState({ printerInventoryNumber: '', model: '', department: '', boss: '' });
  const [recentOps, setRecentOps] = useState<Array<{ text: string; time: string; ok: boolean }>>([]);
  const [fastReceiveMode, setFastReceiveMode] = useState(false);
  const [centerNotice, setCenterNotice] = useState<string | null>(null);
  const [printerIntake, setPrinterIntake] = useState<PrinterIntakeState | null>(null);
  const [printerReturn, setPrinterReturn] = useState<PrinterReturnState | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!showNewForm && !infoCard && !printerIntake && !printerReturn) inputRef.current?.focus();
  }, [mode, showNewForm, infoCard, printerIntake, printerReturn]);

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
    const showCenterNotice = (text: string) => {
      setCenterNotice(text);
      window.setTimeout(() => setCenterNotice(null), 2200);
    };
    e.preventDefault();
    const code = normalizeScannerCode(barcode.trim());
    if (!code) return;
    setBarcode('');

    const cartridge = store.cartridges.find(c => c.barcode === code || c.id === code);
    const scannedPrinter = store.printers.find(
      p => p.inventoryNumber.toLowerCase() === code.toLowerCase() || (p.programId ?? '').toLowerCase() === code.toLowerCase(),
    );

    if (!cartridge && scannedPrinter) {
      if (mode !== 'accept' && mode !== 'receive_refill' && mode !== 'return') {
        showCenterNotice('Принтер можно обработать только в режимах Прием/Прием с ремонта/Выдача');
        return;
      }
      if (mode === 'return') {
        const readyRepair = store.repairs.find(
          r => r.printerInventoryNumber === scannedPrinter.inventoryNumber && r.locationStatus === 'ready',
        );
        if (!readyRepair) {
          showCenterNotice(`Принтер ${scannedPrinter.inventoryNumber} не готов к выдаче`);
          return;
        }
        setPrinterReturn({
          repairId: readyRepair.id,
          printer: scannedPrinter,
          employee: readyRepair.technician ?? scannedPrinter.boss ?? '',
        });
        return;
      }
      const activeRepair = store.repairs.find(
        r =>
          r.printerInventoryNumber === scannedPrinter.inventoryNumber &&
          (r.locationStatus ?? 'waiting') !== 'issued' &&
          (r.status === 'in_repair' || r.status === 'waiting' || r.status === 'repaired'),
      );
      if (activeRepair) {
        if (mode === 'receive_refill') {
          if (activeRepair.locationStatus === 'ready') {
            showCenterNotice(`Принтер ${scannedPrinter.inventoryNumber} уже готов к выдаче`);
            return;
          }
          const isInSentBatch = store.batches.some(
            b =>
              b.status === 'sent' &&
              (b.items?.some(i => i.kind === 'printer' && i.printerInventoryNumber === scannedPrinter.inventoryNumber) ??
                b.cartridgeIds.includes(scannedPrinter.inventoryNumber)),
          );
          if (!isInSentBatch || activeRepair.locationStatus !== 'at_refill') {
            showCenterNotice(`Принтер ${scannedPrinter.inventoryNumber} не находится в "На заправке — партии"`);
            return;
          }
          store.updateRepair(activeRepair.id, {
            status: 'repaired',
            completionDate: new Date().toISOString(),
            locationStatus: 'ready',
            repairDescription: activeRepair.repairDescription ?? 'Принят с заправки по сканеру',
          });
          store.cartridges
            .filter(c => c.linkedRepairId === activeRepair.id && c.status === 'at_refill')
            .forEach(c => {
              store.updateCartridgeStatus(c.id, 'received_from_refill', 'Принят с заправки вместе с принтером');
            });
          store.updatePrinter(scannedPrinter.inventoryNumber, { refillCount: (scannedPrinter.refillCount ?? 0) + 1 });
          store.addRefillLog({
            id: Math.random().toString(36).substr(2, 9),
            date: new Date().toISOString(),
            cartridgeId: scannedPrinter.programId ?? scannedPrinter.inventoryNumber,
            cartridgeModel: scannedPrinter.model,
            consumableType: 'device',
            deviceType: scannedPrinter.printerType,
            serviceType: 'receive',
            printerInventoryNumber: scannedPrinter.inventoryNumber,
            printerModel: scannedPrinter.model,
            department: scannedPrinter.department ?? '',
            employee: scannedPrinter.boss || undefined,
            action: 'Принят с заправки (устройство, сканер)',
          });
          setMessage({ text: `✓ Устройство готово к выдаче: ${scannedPrinter.inventoryNumber}`, type: 'success' });
          addOp(`Готово к выдаче: ${scannedPrinter.inventoryNumber}`, true);
          return;
        }
        showCenterNotice(`Устройство уже в процессе: ${scannedPrinter.inventoryNumber}`);
        return;
      }
      if (mode === 'receive_refill') {
        showCenterNotice(`Устройство ${scannedPrinter.inventoryNumber} не найдено в ремонте`);
        return;
      }
      const printerCartridges = store.cartridges
        .filter(c => c.printerInventoryNumber === scannedPrinter.inventoryNumber && !c.isReplaced);
      setPrinterIntake({
        printer: scannedPrinter,
        reason: '',
        technician: scannedPrinter.boss ?? '',
        includeCartridges: false,
        selectedCartridgeIds: printerCartridges.map(c => c.id),
      });
      return;
    }

    if (!cartridge) {
      if (mode === 'accept') {
        setPendingCode(code);
        setNewForm(f => ({ ...f, printerInventoryNumber: '' }));
        setShowNewForm(true);
        setMessage({ text: `Код «${code}» не найден — зарегистрируйте новый расходник.`, type: 'info' });
      } else {
        setCenterNotice(`Расходник «${code}» не найден в базе!`);
        window.setTimeout(() => setCenterNotice(null), 2200);
        addOp(`Не найден: ${code}`, false);
      }
      return;
    }

    if (mode === 'accept') {
      if (cartridge.status === 'waiting') {
        showCenterNotice(`${cartridge.id} уже добавлен на склад`);
        return;
      }
      if (cartridge.status === 'received_from_refill' || cartridge.status === 'ready') {
        showCenterNotice(`${cartridge.id} имеет статус "Готов к выдаче"`);
        return;
      }
    }

    if (mode === 'receive_refill' && (cartridge.status === 'received_from_refill' || cartridge.status === 'ready')) {
      showCenterNotice(`${cartridge.id} уже в статусе "Готов к выдаче"`);
      return;
    }

    if (mode === 'receive_refill' && fastReceiveMode) {
      if (cartridge.status !== 'at_refill') {
        setCenterNotice(`${cartridge.id} не на заправке (статус: ${STATUS_LABELS[cartridge.status]}).`);
        window.setTimeout(() => setCenterNotice(null), 2200);
        addOp(`Не на заправке: ${cartridge.id}`, false);
        return;
      }
      store.updateCartridgeStatus(cartridge.id, 'received_from_refill', 'Принят с заправки (быстрый режим)');
      const fastPrinter = store.printers.find(p => p.inventoryNumber === cartridge.printerInventoryNumber);
      store.addRefillLog({
        id: Math.random().toString(36).substr(2, 9),
        date: new Date().toISOString(),
        cartridgeId: cartridge.id,
        cartridgeModel: cartridge.model,
        consumableType: cartridge.consumableType ?? 'cartridge',
        deviceType: cartridge.consumableType === 'drum' ? 'Драм' : 'Картридж',
        serviceType: 'refill',
        printerInventoryNumber: cartridge.printerInventoryNumber,
        printerModel: fastPrinter?.model ?? '',
        department: fastPrinter?.department ?? '',
        action: 'Принят с заправки (быстрый режим)',
      });
      setMessage({ text: `✓ Принят с заправки: ${cartridge.id}`, type: 'success' });
      addOp(`Получен с заправки: ${cartridge.id}`, true);
      return;
    }

    // Open info card first (for all modes)
    const printer = store.printers.find(p => p.inventoryNumber === cartridge.printerInventoryNumber);
    setInfoCard({ cartridge, printer, pendingAction: mode });
    setEmployeeInput(cartridge.lastSubmittedBy ?? '');
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const executeAction = () => {
    if (!infoCard) return;
    const { cartridge, pendingAction } = infoCard;
    const employee = employeeInput.trim() || undefined;

    if (pendingAction === 'accept') {
      if (cartridge.status === 'waiting') {
        setMessage({ text: `${cartridge.id} уже добавлен на склад`, type: 'info' });
        addOp(`Уже ожидает: ${cartridge.id}`, false);
      } else if (cartridge.status === 'at_refill') {
        setCenterNotice(`${cartridge.id} на заправке — используйте режим «Прием с заправки».`);
        window.setTimeout(() => setCenterNotice(null), 2200);
        addOp(`На заправке: ${cartridge.id}`, false);
      } else {
        store.updateCartridgeStatus(cartridge.id, 'waiting', 'Принят на склад (сдан на заправку)', employee, employee);

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

        // Log refill action
        const printer = store.printers.find(p => p.inventoryNumber === cartridge.printerInventoryNumber);
        store.addRefillLog({
          id: Math.random().toString(36).substr(2, 9),
          date: new Date().toISOString(),
          cartridgeId: cartridge.id,
          cartridgeModel: cartridge.model,
          consumableType: cartridge.consumableType ?? 'cartridge',
          printerInventoryNumber: cartridge.printerInventoryNumber,
          printerModel: printer?.model ?? '',
          deviceType: cartridge.consumableType === 'drum' ? 'Драм' : 'Картридж',
          serviceType: 'accept',
          department: printer?.department ?? '',
          employee,
          action: 'Принят на склад (сдан на заправку)',
        });

        setMessage({ text: `✓ Принят на склад: ${cartridge.id}`, type: 'success' });
        addOp(`Принят: ${cartridge.id}${employee ? ` (${employee})` : ''}`, true);
      }
    } else if (pendingAction === 'receive_refill') {
      if (cartridge.status !== 'at_refill') {
        setCenterNotice(`${cartridge.id} не на заправке (статус: ${STATUS_LABELS[cartridge.status]}).`);
        window.setTimeout(() => setCenterNotice(null), 2200);
        addOp(`Не на заправке: ${cartridge.id}`, false);
      } else {
        store.updateCartridgeStatus(cartridge.id, 'received_from_refill', 'Принят с заправки');
        const printer = store.printers.find(p => p.inventoryNumber === cartridge.printerInventoryNumber);
        store.addRefillLog({
          id: Math.random().toString(36).substr(2, 9),
          date: new Date().toISOString(),
          cartridgeId: cartridge.id,
          cartridgeModel: cartridge.model,
          consumableType: cartridge.consumableType ?? 'cartridge',
          printerInventoryNumber: cartridge.printerInventoryNumber,
          printerModel: printer?.model ?? '',
          deviceType: cartridge.consumableType === 'drum' ? 'Драм' : 'Картридж',
          serviceType: 'receive',
          department: printer?.department ?? '',
          action: 'Принят с заправки',
        });
        setMessage({ text: `✓ Принят с заправки: ${cartridge.id}`, type: 'success' });
        addOp(`Получен с заправки: ${cartridge.id}`, true);
      }
    } else if (pendingAction === 'return') {
      if (cartridge.status === 'received_from_refill' || cartridge.status === 'ready') {
        store.updateCartridgeStatus(cartridge.id, 'on_hand', 'Выдан пользователю', employee);
        const printer = store.printers.find(p => p.inventoryNumber === cartridge.printerInventoryNumber);
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
        store.addRefillLog({
          id: Math.random().toString(36).substr(2, 9),
          date: new Date().toISOString(),
          cartridgeId: cartridge.id,
          cartridgeModel: cartridge.model,
          consumableType: cartridge.consumableType ?? 'cartridge',
          printerInventoryNumber: cartridge.printerInventoryNumber,
          printerModel: printer?.model ?? '',
          deviceType: cartridge.consumableType === 'drum' ? 'Драм' : 'Картридж',
          serviceType: 'issue',
          department: printer?.department ?? '',
          employee,
          action: 'Выдан пользователю',
        });
        setMessage({ text: `✓ Выдан: ${cartridge.id}`, type: 'success' });
        addOp(`Выдан: ${cartridge.id}${employee ? ` (${employee})` : ''}`, true);
      } else if (cartridge.status === 'on_hand') {
        setCenterNotice(`${cartridge.id} уже на руках.`);
        window.setTimeout(() => setCenterNotice(null), 2200);
        addOp(`Уже на руках: ${cartridge.id}`, false);
      } else {
        setCenterNotice(`Нельзя выдать — статус: ${STATUS_LABELS[cartridge.status]}.`);
        window.setTimeout(() => setCenterNotice(null), 2200);
        addOp(`Нельзя выдать: ${cartridge.id}`, false);
      }
    }

    setInfoCard(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleConfirmPrinterIntake = () => {
    if (!printerIntake) return;
    const existingRepair = store.repairs.find(
      r => r.printerInventoryNumber === printerIntake.printer.inventoryNumber && (r.locationStatus ?? 'waiting') !== 'issued',
    );
    if (existingRepair) {
      setCenterNotice(`Устройство ${printerIntake.printer.inventoryNumber} уже находится в процессе`);
      window.setTimeout(() => setCenterNotice(null), 2200);
      return;
    }
    if (!printerIntake.reason.trim()) {
      setCenterNotice('Укажите неисправность');
      window.setTimeout(() => setCenterNotice(null), 2200);
      return;
    }
    const repair: any = {
      id: Math.random().toString(36).substr(2, 9),
      printerInventoryNumber: printerIntake.printer.inventoryNumber,
      date: new Date().toISOString(),
      reason: printerIntake.reason.trim(),
      status: 'waiting',
      locationStatus: 'waiting',
      technician: printerIntake.technician.trim() || undefined,
      comment: 'Создано по сканированию',
    };
    store.addRepair(repair);
    store.addRefillLog({
      id: Math.random().toString(36).substr(2, 9),
      date: new Date().toISOString(),
      cartridgeId: printerIntake.printer.programId ?? printerIntake.printer.inventoryNumber,
      cartridgeModel: printerIntake.printer.model,
      consumableType: 'device',
      deviceType: printerIntake.printer.printerType,
      serviceType: 'accept',
      printerInventoryNumber: printerIntake.printer.inventoryNumber,
      printerModel: printerIntake.printer.model,
      department: printerIntake.printer.department ?? '',
      employee: printerIntake.technician.trim() || undefined,
      action: 'Принят на склад (устройство, ожидание отправки)',
    });

    if (printerIntake.includeCartridges) {
      store.cartridges
        .filter(c => printerIntake.selectedCartridgeIds.includes(c.id))
        .forEach(c => {
          if (c.status === 'on_hand') {
            store.updateCartridgeStatus(
              c.id,
              'waiting',
              'Принят на склад вместе с принтером',
              printerIntake.technician.trim() || undefined,
              printerIntake.technician.trim() || undefined,
            );
            store.updateCartridge(c.id, { linkedRepairId: repair.id });
            const printer = store.printers.find(p => p.inventoryNumber === c.printerInventoryNumber);
            store.addRefillLog({
              id: Math.random().toString(36).substr(2, 9),
              date: new Date().toISOString(),
              cartridgeId: c.id,
              cartridgeModel: c.model,
              consumableType: c.consumableType ?? 'cartridge',
              deviceType: c.consumableType === 'drum' ? 'Драм' : 'Картридж',
              serviceType: 'accept',
              printerInventoryNumber: c.printerInventoryNumber,
              printerModel: printer?.model ?? '',
              department: printer?.department ?? '',
              employee: printerIntake.technician.trim() || undefined,
              action: 'Принят на склад (вместе с принтером)',
            });
          }
        });
    }

    setMessage({ text: `✓ Устройство принято: ${printerIntake.printer.inventoryNumber}`, type: 'success' });
    addOp(`Склад+ремонт: ${printerIntake.printer.inventoryNumber}`, true);
    setPrinterIntake(null);
  };

  const handleConfirmPrinterReturn = () => {
    if (!printerReturn) return;
    const employee = printerReturn.employee.trim() || undefined;
    store.updateRepair(printerReturn.repairId, { locationStatus: 'issued' });
    store.cartridges
      .filter(c => c.linkedRepairId === printerReturn.repairId && (c.status === 'received_from_refill' || c.status === 'ready'))
      .forEach(c => {
        store.updateCartridgeStatus(c.id, 'on_hand', 'Выдан вместе с принтером', employee);
      });
    store.addRefillLog({
      id: Math.random().toString(36).substr(2, 9),
      date: new Date().toISOString(),
      cartridgeId: printerReturn.printer.programId ?? printerReturn.printer.inventoryNumber,
      cartridgeModel: printerReturn.printer.model,
      consumableType: 'device',
      deviceType: printerReturn.printer.printerType,
      serviceType: 'issue',
      printerInventoryNumber: printerReturn.printer.inventoryNumber,
      printerModel: printerReturn.printer.model,
      department: printerReturn.printer.department ?? '',
      employee,
      action: 'Выдан пользователю (устройство, сканер)',
    });
    setMessage({ text: `✓ Выдан принтер: ${printerReturn.printer.inventoryNumber}`, type: 'success' });
    addOp(`Выдан принтер: ${printerReturn.printer.inventoryNumber}`, true);
    setPrinterReturn(null);
  };

  const handleRegisterNew = (e: React.FormEvent) => {
    e.preventDefault();
    const now = new Date().toISOString();

    const printerExists = store.printers.find(p => p.inventoryNumber === newForm.printerInventoryNumber);
    const pendingPrinter =
      !printerExists && newForm.printerInventoryNumber
        ? {
            inventoryNumber: newForm.printerInventoryNumber,
            model: 'Неизвестная модель',
            printerType: 'printer' as const,
            department: newForm.department || '',
            boss: newForm.boss || '',
            cartridgeModels: [newForm.model].filter(Boolean),
            commissionDate: '',
            balanceCost: '',
          }
        : undefined;
    if (pendingPrinter) {
      store.addPrinter(pendingPrinter);
    }

    const slot = store.allocateConsumableSlot(
      newForm.printerInventoryNumber,
      'cartridge',
      pendingPrinter,
    );
    const id = store.generateConsumableId('cartridge', newForm.printerInventoryNumber, slot);

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
      consumableSlot: slot,
      printerInventoryNumber: newForm.printerInventoryNumber,
      status: 'waiting',
      history: [histEntry],
      isReplaced: false,
      refillCount: 1,
      registrationDate: now,
    };

    store.addCartridge(cartridge);

    // Auto print if enabled
    if (store.settings.autoPrintOnRegister && store.settings.labelPrinterName && window.electronAPI) {
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
        firmwareFlashed: !!printerExists?.firmwareFlashed,
      });
      window.electronAPI.rawPrint(store.settings.labelPrinterName, tspl, store.settings.labelPrintMode);
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
          <input
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
        {mode === 'receive_refill' && (
          <label className="mt-3 inline-flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={fastReceiveMode}
              onChange={e => setFastReceiveMode(e.target.checked)}
              className="rounded"
            />
            <span>Получать с заправки без карточки подтверждения</span>
          </label>
        )}

        {message && (
          <div className={`mt-5 p-4 rounded-lg flex items-center space-x-3 ${
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
      {centerNotice && (
        <div className="fixed left-1/2 top-24 -translate-x-1/2 z-50 px-6 py-3 bg-amber-100 border border-amber-300 text-amber-900 rounded-xl shadow-lg text-sm font-bold">
          {centerNotice}
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

              {/* Print label shortcut */}
              {infoCard.cartridge && (
                <button
                  onClick={async () => {
                    if (!store.settings.labelPrinterName || !window.electronAPI) return;
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
                      firmwareFlashed: !!printer?.firmwareFlashed,
                    });
                    await window.electronAPI.rawPrint(store.settings.labelPrinterName, tspl, store.settings.labelPrintMode);
                  }}
                  disabled={!store.settings.labelPrinterName || !window.electronAPI}
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
      {printerIntake && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold">Принять принтер в ремонт</h2>
              <button onClick={() => setPrinterIntake(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="space-y-3">
              <div className="text-sm bg-gray-50 p-3 rounded-lg">
                <div className="font-bold">{printerIntake.printer.inventoryNumber}</div>
                <div className="text-gray-500">{printerIntake.printer.model}</div>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Неисправность *</label>
                <textarea
                  className="w-full p-2.5 border rounded-lg text-sm h-20 resize-none"
                  value={printerIntake.reason}
                  onChange={e => setPrinterIntake({ ...printerIntake, reason: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Чей принтер</label>
                <input
                  className="w-full p-2.5 border rounded-lg text-sm"
                  value={printerIntake.technician}
                  onChange={e => setPrinterIntake({ ...printerIntake, technician: e.target.value })}
                />
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={printerIntake.includeCartridges}
                  onChange={e => setPrinterIntake({ ...printerIntake, includeCartridges: e.target.checked })}
                />
                <span>Добавить картриджи этого принтера в ожидание отправки</span>
              </label>
              {printerIntake.includeCartridges && (
                <div className="border rounded-lg p-2 max-h-40 overflow-y-auto space-y-1">
                  {store.cartridges
                    .filter(c => c.printerInventoryNumber === printerIntake.printer.inventoryNumber && !c.isReplaced)
                    .map(c => (
                      <label key={c.id} className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={printerIntake.selectedCartridgeIds.includes(c.id)}
                          onChange={() => setPrinterIntake({
                            ...printerIntake,
                            selectedCartridgeIds: printerIntake.selectedCartridgeIds.includes(c.id)
                              ? printerIntake.selectedCartridgeIds.filter(x => x !== c.id)
                              : [...printerIntake.selectedCartridgeIds, c.id],
                          })}
                        />
                        <span className="font-mono">{c.id}</span>
                        <span>{c.model}</span>
                      </label>
                    ))}
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <button onClick={() => setPrinterIntake(null)} className="flex-1 py-2.5 border rounded-lg text-sm">Отмена</button>
                <button onClick={handleConfirmPrinterIntake} className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-bold">Принять</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {printerReturn && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold">Выдать принтер</h2>
              <button onClick={() => setPrinterReturn(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="space-y-3">
              <div className="text-sm bg-gray-50 p-3 rounded-lg">
                <div className="font-bold">{printerReturn.printer.inventoryNumber}</div>
                <div className="text-gray-500">{printerReturn.printer.model}</div>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Кто забрал</label>
                <input
                  className="w-full p-2.5 border rounded-lg text-sm"
                  value={printerReturn.employee}
                  onChange={e => setPrinterReturn({ ...printerReturn, employee: e.target.value })}
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={() => setPrinterReturn(null)} className="flex-1 py-2.5 border rounded-lg text-sm">Отмена</button>
                <button onClick={handleConfirmPrinterReturn} className="flex-1 py-2.5 bg-green-600 text-white rounded-lg text-sm font-bold">Выдать</button>
              </div>
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
