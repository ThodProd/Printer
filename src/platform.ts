/** Local WebView2 bridge; browser preview deliberately has no native access. */
const webview = (window as unknown as { chrome?: { webview?: {
  postMessage: (message: unknown) => void;
  addEventListener: (name: string, handler: (event: MessageEvent) => void) => void;
} } }).chrome?.webview;
if (webview) {
  const pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  webview.addEventListener('message', event => {
    const { id, result, error } = event.data;
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    if (error) request.reject(new Error(error)); else request.resolve(result);
  });
  const invoke = (method: string, ...args: unknown[]): Promise<any> => new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    pending.set(id, { resolve, reject });
    webview.postMessage({ id, method, args });
  });
  window.desktopAPI = {
    isDesktop: true,
    ready: () => invoke('frontend-ready'),
    getPrinters: () => invoke('get-printers'),
    rawPrint: (name, data, mode) => invoke('raw-print', name, data, mode),
    pingPrinter: name => invoke('ping-printer', name),
    getAppVersion: () => invoke('get-version'),
    showSaveDialog: options => invoke('show-save-dialog', options),
    openFolder: path => invoke('open-folder', path),
    installDriver: () => invoke('install-driver'),
    loadDatabase: () => invoke('load-database'),
    saveDatabase: (data, backup) => invoke('save-database', data, backup),
    getDataFolder: () => invoke('get-data-folder'),
    finishClose: success => invoke('finish-close', success),
  };
}
export {};
