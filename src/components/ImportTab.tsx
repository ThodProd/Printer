
import React, { useState } from 'react';
import { FileText, CheckCircle2, AlertCircle, Info } from 'lucide-react';
import { Cartridge, Printer, PrinterType } from '../types';
import { StoreType } from '../store';
import { COLOR_CARTRIDGES, isColorPrinter, suggestCartridgeModels, suggestDrumModel } from '../utils/cartridgeMatcher';

interface ParsedPrinter extends Printer {
  _raw: string;
  _isColor: boolean;
  _drumModel?: string;
}

function normalizeInventoryNumber(value: string): string {
  return value.replace(/^\s*Инв\.\s*№\s*/i, '').trim();
}

const ImportTab: React.FC<{ store: StoreType }> = ({ store }) => {
  const [fileData, setFileData] = useState('');
  const [preview, setPreview] = useState<ParsedPrinter[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  /**
   * Format: МатОтв; ИнвНомер; Подразделение; Тип; Модель; Картриджи(через,); Дата; Стоимость
   * Подразделение — новое поле (3-е место)
   * Для обратной совместимости также поддерживается старый формат без Подразделения (7 полей).
   */
  const parseLine = (line: string, idx: number): ParsedPrinter | string => {
    const delimiter = line.includes(';') ? ';' : '\t';
    const parts = line.split(delimiter).map(s => s.trim());

    if (parts.length < 4) {
      return `Строка ${idx + 1}: недостаточно полей (минимум 4, разделитель ; или табуляция)`;
    }

    let boss: string, inventoryNumber: string, department: string, typeRaw: string,
        model: string, cartridgesRaw: string, commissionDate: string, balanceCost: string;

    if (parts.length >= 8) {
      // New format with department: МатОтв; ИнвНомер; Подразделение; Тип; Модель; Картриджи; Дата; Стоимость
      [boss, inventoryNumber, department, typeRaw, model, cartridgesRaw, commissionDate, balanceCost] = parts;
    } else {
      // Old format without department: МатОтв; ИнвНомер; Тип; Модель; Картриджи; Дата; Стоимость
      [boss, inventoryNumber, typeRaw, model, cartridgesRaw, commissionDate, balanceCost] = parts;
      department = '';
    }

    inventoryNumber = normalizeInventoryNumber(inventoryNumber);
    if (!inventoryNumber) return `Строка ${idx + 1}: пустой инвентарный номер`;
    if (!model) return `Строка ${idx + 1}: пустая модель`;

    const typeNorm = typeRaw?.toLowerCase() ?? '';
    let printerType: PrinterType = 'printer';
    if (typeNorm.includes('мфу') || typeNorm.includes('mfu') || typeNorm.includes('мфо')) {
      printerType = 'mfu';
    } else if (typeNorm && typeNorm !== 'принтер' && typeNorm !== 'printer') {
      printerType = typeRaw; // custom type
    }

    const parsedCartridgeModels = cartridgesRaw
      ? cartridgesRaw.split(',').map(s => s.trim()).filter(Boolean)
      : [];
    const cartridgeModels = parsedCartridgeModels.length > 0
      ? parsedCartridgeModels
      : suggestCartridgeModels(model);
    const colorPrinter = isColorPrinter(typeRaw, model);

    return {
      boss: boss || '',
      programId: store.generatePrinterId(),
      inventoryNumber,
      printerType,
      model,
      department: department || '',
      cartridgeModels,
      commissionDate: commissionDate || '',
      balanceCost: balanceCost || '',
      _isColor: colorPrinter,
      _drumModel: suggestDrumModel(model),
      _raw: line,
    };
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setFileData(text);

    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const parsed: ParsedPrinter[] = [];
    const errs: string[] = [];

    lines.forEach((line, i) => {
      const result = parseLine(line, i);
      if (typeof result === 'string') {
        errs.push(result);
      } else {
        parsed.push(result);
      }
    });

    setPreview(parsed);
    setErrors(errs);
  };

  const handleImport = () => {
    let createdCartridges = 0;
    const printerInvsWithConsumables = new Set(store.cartridges.map(c => c.printerInventoryNumber));
    preview.forEach(({ _raw: _, _isColor, _drumModel, ...printer }) => {
      store.addPrinter(printer);
      const surname = printer.boss.trim().split(/\s+/)[0];
      if (surname && !store.employees.some(e => e.name === surname && e.printerInventoryNumber === printer.inventoryNumber)) {
        store.addEmployee({
          id: Math.random().toString(36).substr(2, 9),
          name: surname,
          printerInventoryNumber: printer.inventoryNumber,
          addedDate: new Date().toISOString(),
        });
      }

      const hasConsumable = printerInvsWithConsumables.has(printer.inventoryNumber);
      if (!hasConsumable) {
        const modelsToCreate = _isColor ? COLOR_CARTRIDGES : [{ color: undefined, label: printer.cartridgeModels[0] ?? '' }];
        modelsToCreate.forEach((item, index) => {
          const id = store.generateConsumableId('cartridge');
          const cartridge: Cartridge = {
            id,
            barcode: id,
            model: _isColor ? (printer.cartridgeModels[index] ?? item.label) : item.label,
            color: item.color,
            consumableType: 'cartridge',
            printerInventoryNumber: printer.inventoryNumber,
            status: 'on_hand',
            history: [{
              id: Math.random().toString(36).substr(2, 9),
              date: new Date().toISOString(),
              action: 'Зарегистрирован при импорте. Выдан пользователю.',
            }],
            refillCount: 0,
            registrationDate: new Date().toISOString(),
          };
          store.addCartridge(cartridge);
          createdCartridges += 1;
        });
        if (_drumModel) {
          const id = store.generateConsumableId('drum');
          store.addCartridge({
            id,
            barcode: id,
            model: _drumModel,
            consumableType: 'drum',
            printerInventoryNumber: printer.inventoryNumber,
            status: 'on_hand',
            history: [{
              id: Math.random().toString(36).substr(2, 9),
              date: new Date().toISOString(),
              action: 'Зарегистрирован драм при импорте.',
            }],
            refillCount: 0,
            registrationDate: new Date().toISOString(),
          });
        }
        printerInvsWithConsumables.add(printer.inventoryNumber);
      }
    });
    setFileData('');
    setPreview([]);
    setErrors([]);
    alert(`Импортировано ${preview.length} принтеров. Создано расходников: ${createdCartridges}`);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Instructions */}
      <div className="bg-blue-50 p-5 rounded-xl border border-blue-100 flex items-start space-x-4">
        <Info className="text-blue-600 mt-1 shrink-0" size={22} />
        <div className="space-y-2 text-sm">
          <h3 className="font-bold text-blue-800 uppercase text-sm">Инструкция по импорту</h3>
          <p className="text-blue-700">
            Вставьте данные из Excel или текстового файла. Разделитель — точка с запятой (<b>;</b>) или табуляция из Excel.
          </p>
          <div className="bg-white rounded-lg border border-blue-200 p-3 font-mono text-xs text-blue-800 leading-relaxed">
            <div className="text-blue-400 mb-1">Формат с Подразделением (каждый принтер — отдельная строка):</div>
            <div className="font-bold">
              ФИО Мат.ответственного ; Инвентарный номер ; Подразделение ; Тип (Принтер/МФУ) ; Модель ; Картриджи через запятую ; Дата ; Стоимость
            </div>
            <div className="mt-2 text-blue-500">Примеры:</div>
            <div>Иванов И.И.; Инв. № 001; Бухгалтерия; Принтер; HP LaserJet 1020; CF283A; 01.01.2022; 15000</div>
            <div>Петров П.П.; INV-002; Отдел IT; МФУ; Canon MF3010; 725,726; 15.03.2021; 25000</div>
            <div className="mt-2 text-blue-400 text-xs">Старый формат (без Подразделения) также поддерживается:</div>
            <div className="text-blue-500">Иванов И.И.; INV-001; Принтер; HP LaserJet 1020; CF283A; 01.01.2022; 15000</div>
          </div>
          <p className="text-blue-600 text-xs">
            Поля «Дата» и «Стоимость» необязательны. Тип: Принтер / МФУ (если не указан — Принтер). Подразделение можно оставить пустым.
          </p>
        </div>
      </div>

      {/* Input area */}
      <div className="bg-white p-6 rounded-xl shadow-sm border space-y-4">
        <label className="font-bold text-gray-700 flex items-center space-x-2 text-sm">
          <FileText size={17} />
          <span>Данные для импорта</span>
        </label>
        <textarea
          value={fileData}
          onChange={handleInput}
          className="w-full h-48 p-3 border rounded-lg font-mono text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-y"
          placeholder="Иванов И.И.; Инв. № 001; Бухгалтерия; Принтер; HP LaserJet 1020; CF283A; 01.01.2022; 15000"
          spellCheck={false}
        />

        {errors.length > 0 && (
          <div className="space-y-1">
            {errors.map((e, i) => (
              <div key={i} className="flex items-center space-x-2 text-red-600 bg-red-50 px-3 py-1.5 rounded text-xs">
                <AlertCircle size={14} />
                <span>{e}</span>
              </div>
            ))}
          </div>
        )}

        {preview.length > 0 && (
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <h4 className="font-bold text-gray-700 text-sm">
                Предпросмотр — {preview.length} шт.
                {errors.length > 0 && (
                  <span className="ml-2 text-orange-500 text-xs font-normal">(есть ошибки в {errors.length} строках)</span>
                )}
              </h4>
              <button
                onClick={handleImport}
                disabled={preview.length === 0}
                className="bg-blue-600 text-white px-5 py-2 rounded-lg hover:bg-blue-700 font-bold text-sm flex items-center space-x-2 disabled:opacity-50"
              >
                <CheckCircle2 size={16} />
                <span>Подтвердить импорт</span>
              </button>
            </div>

            <div className="overflow-auto border rounded-xl max-h-80">
              <table className="w-full text-xs text-left">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="p-2 border-b font-semibold">Инв. №</th>
                    <th className="p-2 border-b font-semibold">Тип</th>
                    <th className="p-2 border-b font-semibold">Модель</th>
                    <th className="p-2 border-b font-semibold">Подразделение</th>
                    <th className="p-2 border-b font-semibold">Мат. отв.</th>
                    <th className="p-2 border-b font-semibold">Картриджи</th>
                    <th className="p-2 border-b font-semibold">Дата</th>
                    <th className="p-2 border-b font-semibold">Стоимость</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {preview.map((p, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="p-2 font-bold font-mono">{p.inventoryNumber}</td>
                      <td className="p-2">
                        <span className={`px-1.5 py-0.5 rounded font-bold text-xs ${
                          p.printerType === 'mfu'
                            ? 'bg-purple-100 text-purple-700'
                            : p.printerType === 'printer'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-teal-100 text-teal-700'
                        }`}>
                          {p.printerType === 'mfu' ? 'МФУ' : p.printerType === 'printer' ? 'Принтер' : p.printerType}
                        </span>
                      </td>
                      <td className="p-2">{p.model}</td>
                      <td className="p-2 text-gray-600">{p.department || '—'}</td>
                      <td className="p-2">{p.boss}</td>
                      <td className="p-2 text-gray-500">{p.cartridgeModels.join(', ') || '—'}</td>
                      <td className="p-2 text-gray-500">{p.commissionDate || '—'}</td>
                      <td className="p-2 text-gray-500">{p.balanceCost || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ImportTab;
