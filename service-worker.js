var CACHE_NAME = 'prog-atividades-app-v13';
// PDF recebido pelo "Compartilhar" do Android (WhatsApp → Atividades): fica
// guardado aqui só até o app abrir e pegar
var SHARE_CACHE = 'prog-compartilhado';
var ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // Guarda cada arquivo separadamente: se um falhar, os outros ainda são salvos.
      return Promise.all(
        ASSETS.map(function (url) {
          return cache.add(url).catch(function (err) {
            console.log('[SW] Falha ao guardar em cache:', url, err);
          });
        })
      );
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_NAME && k !== SHARE_CACHE; })
            .map(function (k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (event) {
  var url = event.request.url;

  // "Compartilhar → Atividades": o Android manda o PDF pra cá (POST).
  // Guarda o arquivo e abre o app, que lê o PDF na hora.
  if (event.request.method === 'POST' && url.indexOf('/compartilhar-pdf') > -1) {
    event.respondWith(receberCompartilhado_(event.request));
    return;
  }

  // Nunca cachear chamadas ao backend (Google Apps Script) - sempre tentar rede real
  if (url.indexOf('script.google.com') > -1 || url.indexOf('googleusercontent.com') > -1) {
    return;
  }
  // Firebase (login e banco): passa direto, sem o service worker no meio
  if (url.indexOf('googleapis.com') > -1 || url.indexOf('firebaseio.com') > -1 || url.indexOf('firebaseapp.com') > -1) {
    return;
  }
  // Bibliotecas do Firebase e do leitor de PDF: guarda no cache na primeira
  // vez, pra funcionar até sem internet
  if (url.indexOf('gstatic.com/firebasejs/') > -1 || url.indexOf('cdnjs.cloudflare.com/ajax/libs/pdf.js/') > -1) {
    event.respondWith(
      caches.match(event.request).then(function (cached) {
        if (cached) return cached;
        return fetch(event.request).then(function (resp) {
          if (resp && (resp.ok || resp.type === 'opaque')) {
            var copia = resp.clone();
            event.waitUntil(caches.open(CACHE_NAME).then(function (cache) { return cache.put(event.request, copia); }));
          }
          return resp;
        });
      })
    );
    return;
  }

  // O documento principal (index.html) sempre tenta a rede primeiro, pra nunca
  // ficar preso numa versão antiga depois de uma atualização. Só usa o cache
  // se estiver de fato offline.
  if (event.request.mode === 'navigate' || url.indexOf('index.html') > -1) {
    event.respondWith(
      fetch(event.request).then(function (fresh) {
        // event.waitUntil() é essencial aqui: sem ele, o navegador pode
        // encerrar o service worker assim que a resposta é entregue, ANTES
        // dessa gravação no cache terminar - aí a atualização nunca chega a
        // ficar salva, e a versão antiga continua sendo servida offline.
        event.waitUntil(
          caches.open(CACHE_NAME).then(function (cache) {
            return cache.put(event.request, fresh.clone());
          })
        );
        return fresh;
      }).catch(function () {
        return caches.match(event.request).then(function (cached) {
          return cached || caches.match('./index.html');
        });
      })
    );
    return;
  }

  // Outros arquivos (ícones, manifest): cache primeiro, com fallback pra rede
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      return cached || fetch(event.request);
    })
  );
});

function receberCompartilhado_(request) {
  var base = self.registration.scope;
  return request.formData().then(function (form) {
    var arquivos = form.getAll('pdf').filter(function (f) { return f && typeof f !== 'string'; });
    return caches.open(SHARE_CACHE).then(function (cache) {
      return Promise.all(arquivos.map(function (f, i) {
        return cache.put(base + '__compartilhado/' + i, new Response(f, {
          headers: { 'Content-Type': f.type || 'application/pdf', 'X-Nome': encodeURIComponent(f.name || ('arquivo' + (i + 1) + '.pdf')) }
        }));
      })).then(function () {
        return cache.put(base + '__compartilhado/qtd', new Response(String(arquivos.length)));
      });
    });
  }).catch(function (err) {
    console.log('[SW] Falha ao receber o compartilhamento:', err);
  }).then(function () {
    return Response.redirect(base + 'index.html?compartilhado=1', 303);
  });
}
