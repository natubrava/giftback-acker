// Service worker mínimo: só permite instalar o Giftback Acker como aplicativo.
// Não guarda nada em cache (sempre busca a versão mais nova do site e os dados ao vivo).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
