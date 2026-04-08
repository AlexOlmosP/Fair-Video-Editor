import { app, BrowserWindow, session, protocol, net } from 'electron';
import path from 'path';
import { pathToFileURL } from 'url';

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: 'Video Editor',
    backgroundColor: '#08090d',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Remove default menu bar
  win.setMenuBarVisibility(false);

  // Inject COOP/COEP headers for SharedArrayBuffer (FFmpeg.wasm)
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Cross-Origin-Opener-Policy': ['same-origin'],
        'Cross-Origin-Embedder-Policy': ['credentialless'],
      },
    });
  });

  if (isDev) {
    // Dev mode: load from Next.js dev server
    const devPort = process.env.DEV_PORT || '3003';
    win.loadURL(`http://localhost:${devPort}`);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    // Production: serve static export via custom protocol
    win.loadURL('app://./index.html');
  }
}

// Register custom protocol for serving static files in production
if (!isDev) {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'app',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
      },
    },
  ]);
}

app.whenReady().then(() => {
  if (!isDev) {
    // Handle custom app:// protocol to serve static files from out/
    protocol.handle('app', (request) => {
      const url = new URL(request.url);
      let filePath = url.pathname;
      if (filePath === '/' || filePath === '') filePath = '/index.html';

      const fullPath = path.join(__dirname, '..', 'out', filePath);
      return net.fetch(pathToFileURL(fullPath).toString());
    });
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
