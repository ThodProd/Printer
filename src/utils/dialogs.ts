/** In-page dialogs avoid the Windows focus loss caused by blocking Chromium dialogs. */
export function ask(message: string, confirmation = true): Promise<boolean> {
  return new Promise(resolve => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.createElement('dialog');
    dialog.className = 'app-dialog';
    const text = document.createElement('p');
    text.textContent = message;
    const actions = document.createElement('div');
    const close = (accepted: boolean) => { dialog.close(); dialog.remove(); previous?.isConnected && previous.focus(); resolve(accepted); };
    if (confirmation) {
      const cancel = document.createElement('button');
      cancel.textContent = 'Отмена'; cancel.onclick = () => close(false); actions.append(cancel);
    }
    const ok = document.createElement('button');
    ok.textContent = confirmation ? 'Подтвердить' : 'ОК'; ok.onclick = () => close(true); actions.append(ok);
    dialog.append(text, actions); document.body.append(dialog);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(false); });
    dialog.showModal(); (actions.firstElementChild as HTMLElement).focus();
  });
}
export const notify = (message: string) => ask(message, false);
