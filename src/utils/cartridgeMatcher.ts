import { ConsumableColor } from '../types';

export const COLOR_CARTRIDGES: Array<{ color: ConsumableColor; label: string }> = [
  { color: 'black', label: 'Black / K' },
  { color: 'cyan', label: 'Cyan / C' },
  { color: 'magenta', label: 'Magenta / M' },
  { color: 'yellow', label: 'Yellow / Y' },
];

const CARTRIDGE_MAP: Array<[string, string[]]> = [
  ['HP LaserJet Pro M404dn', ['CF259A', 'CF259X']],
  ['Canon i-SENSYS LBP2900', ['Cartridge 703']],
  ['HP LaserJet 3050', ['Q2612A']],
  ['Pantum BP5100DN', ['TL-5120X']],
  ['Pantum P3010DW', ['PC-211EV']],
  ['Xerox Phaser 6010', ['106R01634', '106R01631', '106R01632', '106R01633']],
  ['Xerox Phaser 3250DN', ['106R01373']],
  ['HP Laser Jet P2014', ['Q7553A', 'Q7553X']],
  ['Samsung Xpress SL-M2020', ['MLT-D111S']],
  ['Lexmark В2338dw', ['B232000', 'B232H00']],
  ['Samsung ProXpress M4020ND', ['MLT-D203S', 'MLT-D203L', 'MLT-D203E']],
  ['HP LaserJet Pro 400 M401dn', ['CF280A', 'CF280X']],
  ['Xerox Phaser 3125', ['106R01159']],
  ['Xerox Phaser 3124', ['106R01159']],
  ['HP LaserJet P1005', ['CB435A', 'CB436A']],
  ['HP LaserJet P2015', ['Q7553A', 'Q7553X']],
  ['Canon i-SENSYS LBP 810', ['EP-22']],
  ['Canon i-SENSYS LBP3010', ['Canon 712']],
  ['HP LaserJet 1000', ['C7115A']],
  ['Canon i-SENSYS LBP 3000', ['Canon 712']],
  ['HP LaserJet 3020', ['Q2612A']],
  ['HP LaserJet P1018', ['CB435A', 'CB436A']],
  ['Samsung ML-1615', ['ML-1610D2']],
  ['HP LaserJet P1006', ['CB435A', 'CB436A']],
  ['Brother HL-L5100DN', ['TN-3480', 'TN-3430']],
  ['Xerox Phaser 3140', ['108R00908']],
  ['HP LaserJet P2055', ['CE505A', 'CE505X']],
  ['HP LaserJet P1020', ['Q2612A']],
  ['HP LaserJet P2035', ['CE505A', 'CE505X']],
  ['XEROX PHASER 3117', ['109R00748']],
  ['HP LaserJet 1010', ['Q2612A']],
  ['HP LaserJet Pro P1102', ['CE285A']],
  ['HP LaserJet 1320', ['Q5949A', 'Q5949X']],
  ['HP LaserJet Pro M1120', ['CB436A']],
  ['Samsung SCX 3205/3207', ['MLT-D104S']],
  ['Samsung ML 1641', ['MLT-D108S']],
  ['Samsung ML-1860', ['MLT-D101S']],
  ['Kyocera FS-1060DN', ['TK-1120']],
  ['Samsung ML 1210', ['ML-1210D3']],
  ['Lexmark MS317dn', ['51B2000', '51B2H00']],
  ['Samsung ML-2015', ['ML-2010D3']],
  ['Pantum M7300FDN', ['TL-420X']],
  ['Xerox WorkCentre 5020/DN', ['113R00730']],
  ['Pantum ВM5100ADN', ['TL-5120X']],
  ['Pantum BM5100ADN', ['TL-5120X']],
  ['Xerox WorkCentre 1022DN', ['106R02778']],
  ['Xerox WorkCentre 3220', ['106R01487']],
  ['HP Laser Jet Pro M1536dnf', ['CE278A']],
  ['HP LaserJet Pro M1536dnf', ['CE278A']],
  ['Canon i-SENSYS MF3010', ['Canon 725']],
  ['HP LaserJet Pro M428fdn', ['CF259A', 'CF259X']],
  ['Canon i-SENSYS MF4018', ['FX-10']],
  ['Canon i-SENSYS MF 4018', ['FX-10']],
  ['F+ Imaging M40ADN', ['TL-420X']],
  ['HP LJ PRO M1212nf', ['CE285A']],
  ['Samsung SL-M4070FR', ['MLT-D203S', 'MLT-D203L', 'MLT-D203E']],
  ['Samsung ProXpress SL-M4070FR', ['MLT-D203S', 'MLT-D203L', 'MLT-D203E']],
  ['HP LaserJet Pro M1120n', ['CB436A']],
  ['Samsung SCX-4828FN', ['MLT-D209S', 'MLT-D209L']],
  ['Samsung SCX-4833FD', ['MLT-D205S', 'MLT-D205L']],
  ['Samsung SCX-4300', ['SCX-D4200A']],
  ['Lexmark MB2442adwe', ['B242X00']],
  ['Lexmark MB2442adve', ['B242X00']],
  ['Canon i-SENSYS MF4550D', ['Canon 728']],
  ['Sindoh M500', ['TN-217']],
];

const DRUM_MAP: Array<[string, string]> = [
  ['Pantum BM5100ADN', 'DL-5120'],
  ['Pantum ВM5100ADN', 'DL-5120'],
  ['Pantum BP5100DN', 'DL-5120'],
  ['Pantum P3010DW', 'DL-420'],
  ['Pantum M7300FDN', 'DL-420'],
  ['Brother HL-L5100DN', 'DR-3400'],
  ['Sindoh M500', 'DR-217'],
];

function normalizeModel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[ё]/g, 'е')
    .replace(/[в]/g, 'b')
    .replace(/[^a-zа-я0-9]+/g, '');
}

function scoreMatch(source: string, target: string): number {
  const a = normalizeModel(source);
  const b = normalizeModel(target);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.includes(b) || b.includes(a)) return 80;
  const tokens = target.toLowerCase().split(/[^a-zа-я0-9]+/i).filter(t => t.length >= 3);
  const hits = tokens.filter(t => source.toLowerCase().includes(t)).length;
  return hits > 0 ? Math.round((hits / tokens.length) * 70) : 0;
}

export function suggestCartridgeModels(printerModel: string): string[] {
  const best = CARTRIDGE_MAP
    .map(([model, cartridges]) => ({ cartridges, score: scoreMatch(printerModel, model) }))
    .sort((a, b) => b.score - a.score)[0];
  return best && best.score >= 45 ? best.cartridges : [];
}

export function suggestDrumModel(printerModel: string): string | undefined {
  const best = DRUM_MAP
    .map(([model, drum]) => ({ drum, score: scoreMatch(printerModel, model) }))
    .sort((a, b) => b.score - a.score)[0];
  return best && best.score >= 60 ? best.drum : undefined;
}

export function isColorPrinter(typeRaw: string, model: string): boolean {
  const value = `${typeRaw} ${model}`.toLowerCase();
  return value.includes('цвет') || value.includes('color') || value.includes('colour');
}
