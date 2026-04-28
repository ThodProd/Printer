
import { AppSettings, LabelTemplate, DEFAULT_LABEL_TEMPLATE } from '../types';

/** TSC TTP-225 runs at 203 DPI → 8 dots per mm */
export const DOTS_PER_MM = 8;

/** Retrieve label template from settings, falling back to default */
export function getTemplate(settings: AppSettings): LabelTemplate {
  if (settings.labelTemplate) return settings.labelTemplate;
  return { ...DEFAULT_LABEL_TEMPLATE, width: settings.labelWidth, height: settings.labelHeight };
}

/**
 * Used only for data import/migration. Printing must keep inventory text intact.
 */
export function cleanInventoryNumber(inv: string): string {
  if (!inv) return inv;
  // Strip only the inventory prefix. Letters inside the inventory number are preserved.
  const cleaned = inv
    .replace(/^\s*Инв\.\s*№\s*/i, '')
    .trim();
  return cleaned || inv;
}

/**
 * Build TSPL job header.
 * CLS clears the current image buffer without advancing a label.
 */
export function buildTSPLHeader(
  settings: Pick<AppSettings, 'labelWidth' | 'labelHeight' | 'labelDensity' | 'labelSpeed' | 'labelGap' | 'labelType' | 'labelRotation'>,
): string {
  const gapLine =
    settings.labelType === 'gap'
      ? `GAP ${settings.labelGap} mm, 0 mm`
      : `BLINE ${settings.labelGap} mm, 0 mm`;
  const dir = settings.labelRotation ?? 0;

  return [
    `CLS`,
    `CODEPAGE 1251`,
    `SIZE ${settings.labelWidth} mm, ${settings.labelHeight} mm`,
    gapLine,
    `DENSITY ${settings.labelDensity}`,
    `SPEED ${settings.labelSpeed}`,
    `DIRECTION ${dir},0`,
    `REFERENCE 0,0`,
  ].join('\r\n');
}

/** Clear volatile printer state after the printed label is queued. */
export function buildTSPLFooter(): string {
  return [
    'PRINT 1,1',
    'CLS',
    'INITIALPRINTER',
  ].join('\r\n');
}

function esc(value: string): string {
  return value.replace(/"/g, '\\"');
}

function dots(value: number | undefined, fallback = 0): number {
  return Math.max(0, Math.round(value ?? fallback));
}

export interface LabelData {
  id: string;
  inv: string;
  cartModel?: string;
  printerModel?: string;
  model?: string;
  fio?: string;
  boss?: string;
  employee?: string;
  department?: string;
  printerType?: string;
  commissionDate?: string;
  balanceCost?: string;
  consumableType?: string;
  status?: string;
  quantity?: string | number;
  location?: string;
  description?: string;
  vendor?: string;
}

/** Replace template variables with actual data */
export function resolveContent(
  tpl: string,
  data: LabelData,
): string {
  const printerModel = data.printerModel ?? data.model ?? '';
  const fio = data.fio ?? data.boss ?? '';
  return tpl
    .replace(/\{id\}/g, data.id)
    .replace(/\{inv\}/g, data.inv)
    .replace(/\{model\}/g, printerModel)
    .replace(/\{printerModel\}/g, printerModel)
    .replace(/\{cartModel\}/g, data.cartModel ?? '')
    .replace(/\{fio\}/g, fio)
    .replace(/\{boss\}/g, fio)
    .replace(/\{employee\}/g, fio)
    .replace(/\{department\}/g, data.department ?? '')
    .replace(/\{printerType\}/g, data.printerType ?? '')
    .replace(/\{commissionDate\}/g, data.commissionDate ?? '')
    .replace(/\{balanceCost\}/g, data.balanceCost ?? '')
    .replace(/\{consumableType\}/g, data.consumableType ?? '')
    .replace(/\{status\}/g, data.status ?? '')
    .replace(/\{quantity\}/g, String(data.quantity ?? ''))
    .replace(/\{location\}/g, data.location ?? '')
    .replace(/\{description\}/g, data.description ?? '')
    .replace(/\{vendor\}/g, data.vendor ?? '')
    .replace(/\{date\}/g, new Date().toLocaleDateString('ru-RU'));
}

/** Build a complete TSPL print job from template + settings + data */
export function buildTSPLLabel(
  template: LabelTemplate,
  settings: AppSettings,
  data: LabelData,
  options: { ignoreCustomTspl?: boolean } = {},
): string {
  if (settings.labelTsplTemplate && !options.ignoreCustomTspl) {
    return resolveContent(settings.labelTsplTemplate, data).trimEnd();
  }

  const effectiveSettings: AppSettings = {
    ...settings,
    labelWidth: template.width,
    labelHeight: template.height,
  };
  const lines: string[] = [buildTSPLHeader(effectiveSettings)];

  template.elements.forEach(el => {
    const content = esc(resolveContent(el.content, data));
    const x = dots(el.x);
    const y = dots(el.y);
    const rotation = el.rotation ?? 0;
    if (el.type === 'qrcode') {
      lines.push(`QRCODE ${x},${y},M,${el.fontScale ?? 3},A,${rotation},"${content}"`);
    } else if (el.type === 'barcode') {
      // readable=0: do NOT print human-readable text below barcode from printer firmware.
      // Use explicit TEXT elements in template for readable text to avoid duplication.
      const height = Math.max(1, dots(el.barcodeHeight ?? el.height, 60));
      lines.push(
        `BARCODE ${x},${y},"${el.barcodeType ?? '128'}",${height},0,${rotation},2,2,"${content}"`,
      );
    } else if (el.type === 'text') {
      const font = el.textTag ?? '3';
      const scale = el.fontScale ?? 1;
      lines.push(`TEXT ${x},${y},"${font}",${rotation},${scale},${scale},"${content}"`);
    }
  });

  lines.push(buildTSPLFooter());
  return lines.join('\r\n').trimEnd();
}

/**
 * TSPL command to reset/initialize printer memory.
 */
export function buildMemoryResetTSPL(): string {
  return 'CLS\r\nINITIALPRINTER\r\nCLS\r\n';
}
