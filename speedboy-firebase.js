/* ═══════════════════════════════════════════════════════════════
   SpeedBoy — configuração única do Firebase
   ───────────────────────────────────────────────────────────────
   Antes deste arquivo, o mesmo objeto de configuração estava copiado
   em index.html, pedido.html, motoboy.html e fatura.html. Qualquer
   troca de projeto exigia lembrar dos quatro.

   As regras em database.rules.json exigem usuário autenticado, então
   NADA pode ler nem escrever no banco antes do login anônimo resolver.
   ═══════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  global.SPEEDBOY_FIREBASE_CONFIG = {
    apiKey:            "AIzaSyDL8c28T9Q-IAK9JihzEXtT-OPiYOx24Jg",
    authDomain:        "speedboy-3c1c6.firebaseapp.com",
    projectId:         "speedboy-3c1c6",
    storageBucket:     "speedboy-3c1c6.firebasestorage.app",
    messagingSenderId: "702743802978",
    appId:             "1:702743802978:web:7b99217bebcc89f9bc8d3b",
    databaseURL:       "https://speedboy-3c1c6-default-rtdb.firebaseio.com"
  };

  /* Login anônimo para as páginas que usam o SDK compat
     (pedido.html, motoboy.html, fatura.html).

     Devolve sempre a MESMA promessa: se a página chamar duas vezes,
     não abre duas sessões. Resolve com o uid; rejeita se o SDK de auth
     não estiver carregado ou o login falhar.

     O index.html usa o SDK modular e faz o próprio login em initFb(). */
  var _promessaLogin = null;

  global.speedboyLoginAnonimo = function () {
    if (_promessaLogin) return _promessaLogin;

    _promessaLogin = new Promise(function (resolve, reject) {
      if (!global.firebase || !global.firebase.auth) {
        reject(new Error('SDK de autenticação do Firebase não carregado'));
        return;
      }
      var auth = global.firebase.auth();

      // Se já existe sessão (o Firebase persiste entre visitas), reaproveita.
      if (auth.currentUser) { resolve(auth.currentUser.uid); return; }

      auth.signInAnonymously()
        .then(function (cred) { resolve(cred.user.uid); })
        .catch(function (err) {
          _promessaLogin = null;   // permite nova tentativa depois
          reject(err);
        });
    });

    return _promessaLogin;
  };
})(window);
