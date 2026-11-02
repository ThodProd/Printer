/** Decode the physical HID key as US English, regardless of Windows layout. */
export function scannerKey(event: Pick<KeyboardEvent, 'code' | 'key' | 'shiftKey' | 'getModifierState'>): string {
  if (/^Key[A-Z]$/.test(event.code)) {
    const letter = event.code.slice(3);
    return event.shiftKey !== event.getModifierState('CapsLock') ? letter : letter.toLowerCase();
  }
  if (/^Digit[0-9]$/.test(event.code)) {
    const digit = event.code.slice(5);
    return event.shiftKey ? ')!@#$%^&*('[Number(digit)] : digit;
  }
  const keys: Record<string, [string, string]> = {
    Minus: ['-', '_'], Equal: ['=', '+'], BracketLeft: ['[', '{'], BracketRight: [']', '}'],
    Backslash: ['\\', '|'], Semicolon: [';', ':'], Quote: ["'", '"'],
    Backquote: ['`', '~'], Comma: [',', '<'], Period: ['.', '>'], Slash: ['/', '?'], Space: [' ', ' '],
  };
  return keys[event.code]?.[event.shiftKey ? 1 : 0] ?? (event.key.length === 1 ? event.key : '');
}
