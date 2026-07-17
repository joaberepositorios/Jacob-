/* ==========================================================================
   Habpt — versão estática (client-side) para GitHub Pages.
   Mesma UI/CSS do app Flask; a lógica roda no navegador e os dados ficam no
   localStorage (por navegador). Sem servidor.
   ========================================================================== */
(function () {
  "use strict";

  // ----------------------------- Armazenamento -----------------------------
  const K = { users: "ht_users", plans: "ht_plans", regs: "ht_regs", session: "ht_session", seq: "ht_seq" };
  const load = (k, def) => { try { const v = JSON.parse(localStorage.getItem(k)); return v === null ? def : v; } catch (e) { return def; } };
  const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const nextId = () => { const s = load(K.seq, 0) + 1; save(K.seq, s); return s; };

  const users = () => load(K.users, []);
  const plans = () => load(K.plans, []);
  const regs  = () => load(K.regs, []);
  const setUsers = a => save(K.users, a);
  const setPlans = a => save(K.plans, a);
  const setRegs  = a => save(K.regs, a);

  const ADMIN_EMAILS = ["joabeealvez@gmail.com"];
  const DIAS_TOTAIS = 40;
  const CATEGORIAS = [
    "Organização pessoal", "Organização de residência", "Organização acadêmica",
    "Estudo", "Leitura", "Entretenimento", "Finanças pessoais", "Trabalho / carreira", "Outro",
  ];
  const MESES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];

  // ----------------------------- Datas -----------------------------
  const ymd = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const parseYmd = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const hojeData = () => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); };
  const diffDias = (a, b) => Math.floor((a - b) / 86400000);
  const proximaMeiaNoite = () => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1).getTime(); };

  // ----------------------------- Modelo -----------------------------
  function usuarioAtual() { const id = load(K.session, null); return id ? users().find(u => u.id === id) || null : null; }
  function porEmail(email) { const e = email.toLowerCase().trim(); return users().find(u => u.email === e) || null; }

  function criarUsuario(nome, numero, email, senha, idade) {
    const arr = users();
    const u = { id: nextId(), nome, numero, email: email.toLowerCase().trim(), senha, idade,
                primeiro_acesso: true, locked_until: null, admin: false, criado_em: Date.now() };
    if (ADMIN_EMAILS.includes(u.email)) u.admin = true;
    arr.push(u); setUsers(arr); return u;
  }
  function salvarUsuario(u) { const arr = users(); const i = arr.findIndex(x => x.id === u.id); if (i >= 0) { arr[i] = u; setUsers(arr); } }

  function planoAtivo(uid) { return plans().filter(p => p.usuario_id === uid && p.ativo).sort((a, b) => b.id - a.id)[0] || null; }
  function criarPlano(uid, categoria, tempo, vezes) {
    const arr = plans();
    const p = { id: nextId(), usuario_id: uid, categoria, tempo_por_dia_min: tempo, vezes_por_dia: vezes,
                dias_totais: DIAS_TOTAIS, data_inicio: ymd(hojeData()), pontos: 0, ativo: true, concluido: false };
    arr.push(p); setPlans(arr); return p;
  }
  function salvarPlano(p) { const arr = plans(); const i = arr.findIndex(x => x.id === p.id); if (i >= 0) { arr[i] = p; setPlans(arr); } }
  function concluirPlano(p) { p.ativo = false; p.concluido = true; salvarPlano(p); }

  function diaAtual(p) { return Math.max(1, diffDias(hojeData(), parseYmd(p.data_inicio)) + 1); }
  function historico(pid) { return regs().filter(r => r.plano_id === pid).sort((a, b) => a.dia_numero - b.dia_numero); }
  function registroHoje(pid, dia) { return regs().find(r => r.plano_id === pid && r.dia_numero === dia) || null; }

  function registrarDia(p, dia, status) {
    const arr = regs();
    if (!arr.find(r => r.plano_id === p.id && r.dia_numero === dia)) {
      arr.push({ id: nextId(), plano_id: p.id, dia_numero: dia, data: ymd(hojeData()), status, registrado_em: Date.now() });
      setRegs(arr);
      p.pontos += status === "cumprida" ? 1 : -1; salvarPlano(p);
    }
  }
  function estaTravado(u) { return !!(u.locked_until && Date.now() < u.locked_until); }
  function definirTrava(u) { u.locked_until = proximaMeiaNoite(); salvarUsuario(u); }
  function resetarUsuario(u) {
    u.locked_until = null; salvarUsuario(u);
    const arr = plans(); arr.forEach(p => { if (p.usuario_id === u.id && p.ativo) p.ativo = false; }); setPlans(arr);
  }
  function sequenciaAtual(h) { let s = 0; h.forEach(r => { s = r.status === "cumprida" ? s + 1 : 0; }); return s; }

  // Engajamento (derivado do histórico): ofensiva, melhor, congeladores, marcos.
  const MARCOS = [3, 7, 14, 30, 40];
  const CAP_CONGELADORES = 3, GANHA_A_CADA = 5;
  const FRASES = [
    "Um dia de cada vez constrói o hábito.", "Constância vence intensidade.",
    "Você contra você de ontem.", "Pequenos passos, grandes trilhas.",
    "O hábito nasce da repetição.", "Hoje conta — não quebre a corrente.",
    "Disciplina é liberdade.", "Cada dia cumprido é um tijolo na sua rotina.",
    "A ofensiva mais forte é a que você mantém.", "Foco no processo; o resultado vem.",
    "Comece agora, o futuro agradece.", "40 dias. Um de cada vez.",
  ];
  function fraseDoDia() { const t = new Date(); const d = Math.floor((t - new Date(t.getFullYear(), 0, 0)) / 86400000); return FRASES[d % FRASES.length]; }

  function calcularEngajamento(h) {
    let streak = 0, melhor = 0, freezes = 0, cumpridas = 0, protegido = false;
    h.forEach(r => {
      if (r.status === "cumprida") {
        streak++; cumpridas++;
        if (cumpridas % GANHA_A_CADA === 0 && freezes < CAP_CONGELADORES) freezes++;
        if (streak > melhor) melhor = streak;
        protegido = false;
      } else {
        if (freezes > 0) { freezes--; protegido = true; } else { streak = 0; protegido = false; }
      }
    });
    const marcos = MARCOS.filter(m => melhor >= m);
    return { ofensiva: streak, melhor, congeladores: freezes, marcos, cumpridas, ultimoProtegido: protegido };
  }

  // ----------------------------- Ícones (SVG) -----------------------------
  function icon(name, cls) {
    cls = cls || "ico";
    const P = {
      play: '<polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none"/>',
      pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
      check: '<polyline points="20 6 9 17 4 12"/>',
      x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
      calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
      map: '<polygon points="1 6 8 3 16 6 23 3 23 18 16 21 8 18 1 21 1 6"/><line x1="8" y1="3" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="21"/>',
      target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
      chart: '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>',
      star: '<polygon points="12 3 14.6 8.6 20.6 9.3 16 13.5 17.3 19.4 12 16.3 6.7 19.4 8 13.5 3.4 9.3 9.4 8.6 12 3"/>',
      zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
      flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
      medal: '<circle cx="12" cy="8" r="6"/><path d="M15.48 12.89 17 22l-5-3-5 3 1.52-9.11"/>',
      shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
      lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
      logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
      user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
      clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 16 14"/>',
      chest: '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M3 12h18"/><path d="M3 8l2-4h14l2 4"/><rect x="10" y="11" width="4" height="4" rx="1"/>',
      rocket: '<path d="M5 15c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2 0-2.8a2 2 0 0 0-3 0z"/><path d="M9 12a12 12 0 0 1 8-9c1.7 0 3 1.3 3 3a12 12 0 0 1-9 8"/><path d="M14 8a2 2 0 1 0 0 .01"/>',
      "cat-pessoal": '<path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/>',
      "cat-casa": '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M9 20v-6h6v6"/>',
      "cat-academica": '<path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1 3 3 6 3s6-2 6-3v-5"/>',
      "cat-estudo": '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19a2 2 0 0 1 2-2h13"/>',
      "cat-leitura": '<path d="M2 5s3-1.5 5-1.5S12 5 12 5v15s-3-1.5-5-1.5S2 20 2 20z"/><path d="M12 5s3-1.5 5-1.5S22 5 22 5v15s-3-1.5-5-1.5S12 20 12 20z"/>',
      "cat-entretenimento": '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none"/>',
      "cat-financas": '<circle cx="12" cy="12" r="9"/><path d="M12 7v10"/><path d="M15 9.5c0-1.4-1.3-2.5-3-2.5s-3 1-3 2.3 1.3 1.9 3 2.2 3 .9 3 2.2-1.3 2.3-3 2.3-3-1-3-2.5"/>',
      "cat-trabalho": '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M2 13h20"/>',
    };
    return '<svg class="' + cls + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[name] || '<circle cx="12" cy="12" r="9"/>') + '</svg>';
  }
  function catIcon(cat, cls) {
    const map = { "Organização pessoal": "cat-pessoal", "Organização de residência": "cat-casa",
      "Organização acadêmica": "cat-academica", "Estudo": "cat-estudo", "Leitura": "cat-leitura",
      "Entretenimento": "cat-entretenimento", "Finanças pessoais": "cat-financas", "Trabalho / carreira": "cat-trabalho", "Outro": "star" };
    return icon(map[cat] || "star", cls);
  }
  const marcaJ = () => '<span class="marca-j" aria-label="Habpt"><span class="mj-letra">Habpt</span></span>';

  // ----------------------------- Roteamento -----------------------------
  const root = () => document.getElementById("root");
  let flash = null;               // { cat, msg }
  function setFlash(cat, msg) { flash = { cat, msg }; }
  function flashHTML() {
    if (!flash) return "";
    const h = '<div class="flash-list"><div class="flash ' + flash.cat + '">' + flash.msg + "</div></div>";
    flash = null; return h;
  }
  function go(view) { location.hash = "#" + view; }
  function navegar(view) { if ("#" + view === location.hash) render(); else location.hash = "#" + view; }
  window.addEventListener("hashchange", render);

  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  // ----------------------------- Render principal -----------------------------
  function render() {
    const u = usuarioAtual();
    let view = (location.hash || "#login").slice(1).split("?")[0];
    const verBloqueado = (location.hash || "").indexOf("ver=1") >= 0;

    if (!u) { return (view === "cadastro") ? viewCadastro() : viewLogin(); }
    if (u.primeiro_acesso && !planoAtivo(u.id)) { if (view !== "planejamento") return go("planejamento"); }

    if (view === "cadastro" || view === "login") return go("dashboard");
    if (view === "planejamento") return viewPlanejamento(u);
    if (view === "foco") return viewFoco(u);
    if (view === "historico") return viewHistorico(u);
    if (view === "concluido") return viewConcluido(u);
    return viewDashboard(u, verBloqueado);
  }

  // ----------------------------- Auth -----------------------------
  function authShell(inner) { root().innerHTML = '<div class="auth-wrap"><div class="auth-card">' + inner + "</div></div>"; }

  function viewLogin() {
    authShell(
      '<div class="brand-mark">' + marcaJ() + "</div>" +
      '<div class="eyebrow">Bem-vindo de volta</div><h1>Entrar</h1>' +
      '<p class="desc">Sua trilha está esperando pela missão de hoje. Não quebre a sequência.</p>' +
      flashHTML() +
      '<form id="f"><div class="field"><label>E-mail</label><input type="email" id="email" required autofocus></div>' +
      '<div class="field"><label>Senha</label><input type="password" id="senha" required></div>' +
      '<button class="btn btn-primary" type="submit">Entrar</button></form>' +
      '<div class="auth-switch">Ainda não tem conta? <a href="#cadastro">Criar conta</a></div>'
    );
    document.getElementById("f").addEventListener("submit", e => {
      e.preventDefault();
      const u = porEmail(val("email"));
      if (!u || u.senha !== val("senha")) { setFlash("erro", "E-mail ou senha incorretos."); return viewLogin(); }
      if (ADMIN_EMAILS.includes(u.email) && !u.admin) { u.admin = true; salvarUsuario(u); }
      save(K.session, u.id);
      go(u.primeiro_acesso ? "planejamento" : "dashboard");
    });
  }

  function viewCadastro() {
    authShell(
      '<div class="brand-mark">' + marcaJ() + "</div>" +
      '<div class="eyebrow">Dia zero da sua trilha</div><h1>Criar conta</h1>' +
      '<p class="desc">40 dias de constância começam com um cadastro de 1 minuto.</p>' +
      flashHTML() +
      '<form id="f"><div class="field"><label>Nome completo</label><input type="text" id="nome" required></div>' +
      '<div class="row-2"><div class="field"><label>Telefone</label><input type="tel" id="numero" required></div>' +
      '<div class="field"><label>Idade</label><input type="number" id="idade" min="10" max="120" required></div></div>' +
      '<div class="field"><label>E-mail</label><input type="email" id="email" required></div>' +
      '<div class="row-2"><div class="field"><label>Senha</label><input type="password" id="senha" required></div>' +
      '<div class="field"><label>Confirmar senha</label><input type="password" id="senha2" required></div></div>' +
      '<button class="btn btn-primary" type="submit">Criar minha conta</button></form>' +
      '<div class="auth-switch">Já tem conta? <a href="#login">Entrar</a></div>'
    );
    document.getElementById("f").addEventListener("submit", e => {
      e.preventDefault();
      const nome = val("nome"), numero = val("numero"), email = val("email"), senha = val("senha");
      const idade = parseInt(val("idade"), 10);
      const erros = [];
      if (!nome) erros.push("Informe seu nome.");
      if (!numero) erros.push("Informe um número de telefone.");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) erros.push("Informe um e-mail válido.");
      if (senha.length < 6) erros.push("A senha precisa ter pelo menos 6 caracteres.");
      if (senha !== val("senha2")) erros.push("A confirmação de senha não bate.");
      if (!(idade >= 10 && idade <= 120)) erros.push("Informe uma idade válida.");
      if (porEmail(email)) erros.push("Já existe uma conta com este e-mail.");
      if (erros.length) { setFlash("erro", erros[0]); return viewCadastro(); }
      const u = criarUsuario(nome, numero, email, senha, idade);
      save(K.session, u.id);
      setFlash("sucesso", "Conta criada! Vamos montar seu planejamento.");
      go("planejamento");
    });
  }

  // ----------------------------- Planejamento -----------------------------
  function viewPlanejamento(u) {
    const chips = CATEGORIAS.map((c, i) =>
      '<label class="chip"><input type="radio" name="categoria" value="' + esc(c) + '" ' + (i === 0 ? "checked" : "") + ">" + catIcon(c) + " " + esc(c) + "</label>").join("");
    root().innerHTML = '<div class="plano-wrap"><div class="plano-card">' +
      '<div class="brand-mark">' + marcaJ() + "</div>" +
      '<div class="eyebrow">Primeiro acesso</div><h1>Monte seu planejamento</h1>' +
      '<p class="desc">Escolha uma área para praticar todos os dias, sem pular nenhum, por 40 dias seguidos.</p>' +
      flashHTML() +
      '<form id="f"><label class="eyebrow">Em que você quer ser produtivo?</label>' +
      '<div class="chip-grid">' + chips + "</div>" +
      '<div class="row-2"><div class="field"><label>Tempo por dia (minutos)</label><input type="number" id="tempo" min="1" value="30" required></div>' +
      '<div class="field"><label>Vezes ao dia</label><input type="number" id="vezes" min="1" value="1" required><div class="hint">Quantas sessões por dia.</div></div></div>' +
      '<div class="hint" style="margin-bottom:18px;">A trilha roda todos os dias, por 40 dias seguidos, começando hoje.</div>' +
      '<button class="btn btn-primary" type="submit">' + icon("play") + " Começar minha trilha de 40 dias</button></form>" +
      "</div></div>";
    document.getElementById("f").addEventListener("submit", e => {
      e.preventDefault();
      const cat = (document.querySelector('input[name=categoria]:checked') || {}).value;
      const tempo = parseInt(val("tempo"), 10), vezes = parseInt(val("vezes"), 10);
      if (!CATEGORIAS.includes(cat) || !(tempo > 0) || !(vezes > 0)) { setFlash("erro", "Preencha os campos corretamente."); return viewPlanejamento(u); }
      criarPlano(u.id, cat, tempo, vezes);
      u.primeiro_acesso = false; salvarUsuario(u);
      setFlash("sucesso", "Planejamento criado! Sua trilha de 40 dias começa hoje.");
      go("dashboard");
    });
  }

  // ----------------------------- Topbar -----------------------------
  function topbar(u, ativa) {
    const tab = (view, ic, txt) => '<a href="#' + view + '" class="tab ' + (ativa === view ? "ativa" : "") + '">' + icon(ic) + " <span>" + txt + "</span></a>";
    let rec = "";
    if (u.admin) rec = '<button id="btn-recomecar" class="tb-recomecar" title="Recomeçar (admin)">' + icon("rocket") + " <span>Recomeçar</span></button>";
    return '<header class="topbar"><a class="tb-brand" href="#dashboard">' + marcaJ() + "</a>" +
      '<nav class="tb-tabs">' + tab("dashboard", "target", "Painel de hoje") + tab("historico", "chart", "Histórico") + "</nav>" +
      '<div class="tb-user">' + rec + '<span class="tb-nome">' + esc(u.nome) + '</span>' +
      '<a href="#logout" id="btn-sair" class="tb-sair" title="Sair da conta">' + icon("logout") + "</a></div></header>";
  }
  function ligarTopbar(u) {
    const sair = document.getElementById("btn-sair");
    if (sair) sair.addEventListener("click", e => { e.preventDefault(); save(K.session, null); go("login"); });
    const rec = document.getElementById("btn-recomecar");
    if (rec) rec.addEventListener("click", () => {
      if (!u.admin) return;
      if (confirm("Recomeçar do zero? Sua trilha atual será encerrada e você monta uma nova.")) {
        resetarUsuario(u); setFlash("sucesso", "Status resetado! Monte sua nova trilha.");
        u.primeiro_acesso = true; salvarUsuario(u); go("planejamento");
      }
    });
  }

  // ----------------------------- Dashboard -----------------------------
  function corMarco() { return ""; }

  function viewDashboard(u, verBloqueado) {
    const p = planoAtivo(u.id);
    if (!p) return go("planejamento");
    const travado = estaTravado(u);
    if (travado && !verBloqueado) return viewTravado(u);

    let dia = diaAtual(p);
    if (dia > p.dias_totais) { concluirPlano(p); return viewConcluido(u, p); }

    const h = historico(p.id);
    const reg = registroHoje(p.id, dia);
    const cumpridas = h.filter(r => r.status === "cumprida").length;
    const seq = sequenciaAtual(h);
    const eng = calcularEngajamento(h);
    const pct = Math.round((dia - 1) / p.dias_totais * 100);
    const statusPorDia = {}; h.forEach(r => statusPorDia[r.dia_numero] = r.status);
    const inicio = parseYmd(p.data_inicio);

    // trilha
    let trilha = "";
    for (let d = 1; d <= p.dias_totais; d++) {
      let estado = statusPorDia[d] || (d === dia ? "hoje" : d < dia ? "falha" : "futuro");
      const data = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + (d - 1));
      const ultimo = d === p.dias_totais;
      trilha += '<div class="marco ' + estado + (ultimo ? " tesouro-fim" : "") + '" style="--i:' + (d - 1) + ';" title="Dia ' + d + '">' +
        (ultimo ? icon("chest") : data.getDate()) + "</div>";
    }

    // calendário (mês atual)
    const t = new Date(); const ano = t.getFullYear(), mes = t.getMonth();
    const fim = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + (p.dias_totais - 1));
    let primeiro = new Date(ano, mes, 1); let ini = new Date(primeiro); ini.setDate(1 - ((primeiro.getDay() + 6) % 7));
    let cal = "";
    for (const d of ["Seg","Ter","Qua","Qui","Sex","Sáb","Dom"]) cal += '<div class="cal-dow">' + d + "</div>";
    for (let i = 0; i < 42; i++) {
      const cd = new Date(ini.getFullYear(), ini.getMonth(), ini.getDate() + i);
      let cls = "cal-cel", ehHoje = ymd(cd) === ymd(hojeData());
      if (cd.getMonth() !== mes) cls += " fora";
      if (cd >= inicio && cd <= fim) {
        const dn = diffDias(cd, inicio) + 1;
        let est = statusPorDia[dn] || (ehHoje ? "hoje" : cd < hojeData() ? "falha" : "futuro");
        cls += " plano " + est;
      }
      if (ehHoje) cls += " hoje";
      cal += '<div class="' + cls + '">' + cd.getDate() + "</div>";
      if (i >= 34 && cd >= fim && cd.getMonth() !== mes) {} // deixa a grade completa
    }

    // bloco de ações
    let acoes;
    if (reg) {
      if (reg.status === "cumprida") {
        acoes = '<div class="status-feito fogo-aviso sucesso"><div class="fogo" aria-hidden="true">' +
          '<span class="flare"></span><span class="brasa"></span><span class="chama c1"></span><span class="chama c2"></span><span class="chama c3"></span></div>' +
          '<div class="txt"><div class="titulo-fogo">Missão cumprida hoje!</div><div class="sub-fogo">Você tá <strong>pegando fogo</strong> — volte amanhã para manter a chama acesa.</div></div></div>';
      } else {
        acoes = '<div class="status-feito falhou fogo-aviso congelou"><div class="fogo" aria-hidden="true">' +
          '<span class="flare"></span><span class="brasa"></span><span class="chama c1"></span><span class="chama c2"></span><span class="chama c3"></span><span class="pedra-gelo"></span></div>' +
          '<div class="txt"><div class="titulo-fogo">Você <span class="destaque">DESISTIU</span> de uma missão hoje</div><div class="sub-fogo">A chama acendeu e <strong>congelou</strong>… mas amanhã ela pode queimar de novo.</div></div></div>';
      }
    } else if (travado) {
      acoes = '<div class="status-feito"><span class="badge" style="background:var(--ink-soft);">' + icon("lock") + "</span>" +
        "<div>App bloqueado até a virada do dia. Você pode <strong>acompanhar o andamento</strong>, mas não executar tarefas agora.</div></div>";
    } else {
      acoes = '<div class="missao-icone">' + catIcon(p.categoria, "ico") + "</div>" +
        '<div class="missao">Missão do dia ' + dia + "</div>" +
        '<div class="missao-detalhe">' + p.tempo_por_dia_min + ' minutos de "' + esc(p.categoria) + '", ' + p.vezes_por_dia + "x hoje.</div>" +
        '<div id="tarefa-andamento" class="timer-chip" style="display:none;">' + icon("clock") + ' <span>Tarefa em andamento — <b id="ta-rest">--:--</b></span> <a href="#foco">voltar ao foco →</a></div>' +
        '<div class="acoes-botoes"><a href="#foco" class="btn btn-primary">' + icon("play") + " Iniciar tarefa</a>" +
        '<button id="btn-cumpri" class="btn btn-good" type="button">' + icon("check") + " Já cumpri a missão de hoje</button></div>" +
        '<div class="acoes-secundarias"><button id="btn-desisti" class="btn btn-outline" type="button">' + icon("x") + " Desistir de hoje</button></div>";
    }

    const medalhas = '<div class="of-medalhas">' + MARCOS.map(m =>
      '<span class="medalha ' + (eng.marcos.includes(m) ? "ganha" : "bloqueada") + '" title="' + m + ' dias">' + icon("medal") + "<b>" + m + "</b></span>").join("") + "</div>";
    const ofensivaCard = '<div class="ofensiva-card bloco"><div class="of-hero">' +
      '<div class="of-flame">' + icon("flame") + '<span class="of-num">' + eng.ofensiva + "</span></div>" +
      '<div class="of-info"><div class="of-label">dias de ofensiva</div>' +
      '<div class="of-meta">Melhor: ' + eng.melhor + ' &nbsp;·&nbsp; <span class="of-escudos" title="Congeladores de ofensiva">' + icon("shield") + " ×" + eng.congeladores + "</span></div></div></div>" +
      medalhas + '<div class="frase-dia">"' + esc(fraseDoDia()) + "\"</div></div>";
    let risco = "";
    if (!reg && !travado) risco = eng.ofensiva > 0
      ? '<div class="of-risco">' + icon("flame") + " Sua ofensiva de <b>" + eng.ofensiva + "</b> dias está em risco — cumpra a missão de hoje!</div>"
      : '<div class="of-risco">' + icon("flame") + " Comece sua ofensiva hoje — cumpra a primeira missão!</div>";

    root().innerHTML = topbar(u, "dashboard") + '<main class="main">' +
      (travado ? '<div class="lock-note">' + icon("lock") + ' <span>Modo somente leitura — você já registrou hoje. Nenhuma tarefa pode ser feita até a virada do dia.</span> <a href="#dashboard">ver contagem →</a></div>' : "") + risco +
      '<div class="page-head"><div><h1>Dia ' + dia + " de " + p.dias_totais + "</h1></div>" +
      '<div class="stat-row"><div class="stat-pill flame">' + icon("zap") + ' <span class="n">' + seq + '</span> seguidos</div>' +
      '<div class="stat-pill pts">' + icon("star") + ' <span class="n">' + p.pontos + '</span> pts</div></div></div>' +
      ofensivaCard +
      '<div class="progress-wrap"><div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%;"></div></div>' +
      '<div class="progress-meta"><span>' + cumpridas + " missões cumpridas</span><span>" + pct + "% da trilha</span></div></div>" +
      '<div class="acoes-card bloco">' + acoes + "</div>" +
      '<div class="cal-card bloco"><div class="cal-head"><div class="sec-titulo" style="margin:0;">' + icon("calendar") + " Calendário</div>" +
      '<div class="cal-mes">' + (MESES[mes][0].toUpperCase() + MESES[mes].slice(1)) + " de " + ano + '</div></div><div class="cal-grid">' + cal + "</div>" +
      '<div class="cal-legenda"><span><i class="legenda-dot" style="background:var(--good)"></i> Cumprida</span>' +
      '<span><i class="legenda-dot" style="background:var(--bad-bg);border:1px solid #F3D2D8"></i> Falha</span>' +
      '<span><i class="legenda-dot" style="background:#fff;border:2px solid var(--amber)"></i> Hoje</span>' +
      '<span><i class="legenda-dot" style="background:#fff;border:1px dashed var(--line-2)"></i> Futuro</span></div></div>' +
      '<div class="trilha-card bloco"><div class="sec-titulo">' + icon("map") + " Trilha do tesouro <span class=\"sub\">" + p.tempo_por_dia_min + " min · " + p.vezes_por_dia + 'x ao dia</span></div>' +
      '<div class="tesouro"><div class="tesouro-nós">' + trilha + "</div></div>" +
      '<div class="trilha-legenda"><span><i class="legenda-dot" style="background:var(--good)"></i> Concluído</span>' +
      '<span><i class="legenda-dot" style="background:#fff;border:2px solid var(--amber)"></i> Hoje</span>' +
      '<span><i class="legenda-dot" style="background:#fff;border:1px dashed var(--line-2)"></i> A fazer</span>' +
      '<span><i class="legenda-dot" style="background:#fff;border:1px dashed var(--bad)"></i> Falha</span></div></div>' +
      "</main>";

    ligarTopbar(u);
    const cumpri = document.getElementById("btn-cumpri");
    if (cumpri) cumpri.addEventListener("click", () => {
      if (confirm("Confirmar que a missão de hoje foi cumprida? O app vai travar até 00:00.")) {
        registrarDia(p, dia, "cumprida"); definirTrava(u); navegar("dashboard");
      }
    });
    const desisti = document.getElementById("btn-desisti");
    if (desisti) desisti.addEventListener("click", () => {
      if (confirm("Desistir da missão de hoje? Você perde 1 ponto e o app trava até 00:00.")) {
        registrarDia(p, dia, "falha"); definirTrava(u); navegar("dashboard");
      }
    });
    if (reg) animarFogo(reg.status === "falha");
    ligarIndicadorTimer(p, dia);
  }

  function ligarIndicadorTimer(p, dia) {
    const el = document.getElementById("tarefa-andamento");
    if (!el) return;
    const KEY = "ht_timer_" + p.id + "_" + dia;
    const out = document.getElementById("ta-rest");
    const fmt = s => String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
    function tick() {
      let st; try { st = JSON.parse(localStorage.getItem(KEY)); } catch (e) { st = null; }
      if (!st) { el.style.display = "none"; return; }
      const r = st.pausado ? st.restante : Math.max(0, Math.round((st.fim - Date.now()) / 1000));
      el.style.display = "flex";
      out.textContent = r > 0 ? fmt(r) + (st.pausado ? " (pausado)" : "") : "tempo cumprido";
    }
    tick(); setInterval(tick, 1000);
  }

  // ----------------------------- Foco (timer) -----------------------------
  function viewFoco(u) {
    const p = planoAtivo(u.id);
    if (!p) return go("planejamento");
    if (estaTravado(u)) return go("dashboard");
    const dia = diaAtual(p);
    if (dia > p.dias_totais || registroHoje(p.id, dia)) return go("dashboard");
    const TOTAL = p.tempo_por_dia_min * 60;

    root().innerHTML = '<div class="foco-wrap"><div class="foco-card">' +
      '<div class="brand-mark" style="justify-content:center;">' + marcaJ() + "</div>" +
      '<div class="foco-titulo">' + icon("target") + " Foco na missão</div>" +
      '<div class="foco-sub">' + esc(p.categoria) + " · dia " + dia + " · " + p.vezes_por_dia + "x hoje</div>" +
      '<div class="timer-ring"><svg width="210" height="210" viewBox="0 0 210 210">' +
      '<circle class="track" cx="105" cy="105" r="92" fill="none" stroke-width="14"/>' +
      '<circle id="prog" class="prog" cx="105" cy="105" r="92" fill="none" stroke-width="14" stroke-dasharray="578" stroke-dashoffset="0"/></svg>' +
      '<div class="timer-num"><span id="relogio">00:00</span><small id="rotulo">restante</small></div></div>' +
      '<div class="foco-acoes"><button id="btnPausar" class="btn btn-primary">' + icon("pause") + " Pausar</button>" +
      '<button id="btnCumprir" class="btn btn-good" type="button">' + icon("check") + " Concluí a missão</button>" +
      '<a href="#dashboard" class="btn btn-ghost">Voltar ao painel</a></div></div></div>';

    const CIRC = 578, KEY = "ht_timer_" + p.id + "_" + dia;
    const relogio = document.getElementById("relogio"), rotulo = document.getElementById("rotulo");
    const prog = document.getElementById("prog"), btn = document.getElementById("btnPausar");
    const carregar = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } };
    let st = carregar();
    if (!st) { st = { fim: Date.now() + TOTAL * 1000, pausado: false, restante: TOTAL, done: false }; localStorage.setItem(KEY, JSON.stringify(st)); }
    const salvar = () => localStorage.setItem(KEY, JSON.stringify(st));
    const restante = () => st.pausado ? st.restante : Math.max(0, Math.round((st.fim - Date.now()) / 1000));
    const fmt = s => String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
    function pintar() { const r = restante(); relogio.textContent = fmt(r); prog.style.strokeDashoffset = (CIRC * (1 - (TOTAL ? r / TOTAL : 0))).toFixed(1); }
    function tocar() { try { const c = new (window.AudioContext || window.webkitAudioContext)(); const o = c.createOscillator(), g = c.createGain(); o.connect(g); g.connect(c.destination); o.type = "sine"; o.frequency.value = 660; g.gain.setValueAtTime(.001, c.currentTime); g.gain.exponentialRampToValueAtTime(.2, c.currentTime + .05); g.gain.exponentialRampToValueAtTime(.001, c.currentTime + 1.2); o.start(); o.stop(c.currentTime + 1.2); } catch (e) {} }
    function checarFim() { if (!st.pausado && restante() <= 0) { rotulo.textContent = "tempo cumprido"; btn.disabled = true; btn.style.opacity = .55; if (!st.done) { st.done = true; salvar(); tocar(); } } }
    function rotBtn() { btn.innerHTML = btn.innerHTML.replace(/Pausar|Retomar/, st.pausado ? "Retomar" : "Pausar"); }
    btn.addEventListener("click", () => { if (btn.disabled) return; if (st.pausado) { st.pausado = false; st.fim = Date.now() + st.restante * 1000; } else { st.pausado = true; st.restante = restante(); } salvar(); rotBtn(); pintar(); });
    document.getElementById("btnCumprir").addEventListener("click", () => {
      if (confirm("Confirmar que a missão de hoje foi cumprida? O app vai travar até 00:00.")) {
        registrarDia(p, dia, "cumprida"); definirTrava(u); navegar("dashboard");
      }
    });
    rotBtn(); pintar(); checarFim();
    setInterval(() => { pintar(); checarFim(); }, 500);
  }

  // ----------------------------- Histórico -----------------------------
  function viewHistorico(u) {
    const p = planoAtivo(u.id);
    if (!p) return go("planejamento");
    const h = historico(p.id);
    const cumpridas = h.filter(r => r.status === "cumprida"), falhas = h.filter(r => r.status === "falha");
    const tabela = (arr, vazio) => arr.length
      ? '<table><thead><tr><th>Dia</th><th>Data</th></tr></thead><tbody>' + arr.map(r => "<tr><td>Dia " + r.dia_numero + "</td><td>" + r.data + "</td></tr>").join("") + "</tbody></table>"
      : '<div class="vazio">' + vazio + "</div>";
    root().innerHTML = topbar(u, "historico") + '<main class="main">' +
      '<div class="page-head"><div><div class="eyebrow">' + esc(p.categoria) + '</div><h1>Histórico da trilha</h1></div>' +
      '<div class="stat-row"><div class="stat-pill pts">' + icon("star") + ' <span class="n">' + p.pontos + '</span> pts</div></div></div>' +
      '<div class="tabelas"><div class="tabela-card"><h3><span class="ok">' + icon("check") + '</span> Missão cumprida <span class="count-badge">' + cumpridas.length + "</span></h3>" +
      tabela(cumpridas, "Nenhum dia cumprido ainda. Bora começar.") + "</div>" +
      '<div class="tabela-card"><h3><span class="no">' + icon("x") + '</span> Missão falha <span class="count-badge">' + falhas.length + "</span></h3>" +
      tabela(falhas, "Nenhuma falha registrada ainda. Constância impecável.") + "</div></div></main>";
    ligarTopbar(u);
  }

  // ----------------------------- Travado -----------------------------
  function viewTravado(u) {
    const p = planoAtivo(u.id);
    const h = p ? historico(p.id) : [];
    const dia = p ? diaAtual(p) : 0;
    const eng = calcularEngajamento(h);
    const antes = calcularEngajamento(h.filter(r => r.dia_numero !== dia));
    const novos = eng.marcos.filter(m => !antes.marcos.includes(m));
    const reg = p ? registroHoje(p.id, dia) : null;
    const protegido = reg && reg.status === "falha" && eng.ofensiva === antes.ofensiva && eng.ofensiva > 0;

    let feedback = '<div class="lock-ofensiva">' + icon("flame") + ' <b>' + eng.ofensiva + '</b> dias de ofensiva' +
      (eng.congeladores ? ' <span class="lock-escudo">' + icon("shield") + " ×" + eng.congeladores + "</span>" : "") + "</div>";
    if (novos.length) feedback += '<div class="lock-marco">' + icon("medal") + " Novo marco: <b>" + Math.max.apply(null, novos) + " dias</b>! 🎉</div>";
    if (protegido) feedback += '<div class="lock-protegido">' + icon("shield") + " Congelador usado — sua ofensiva foi <b>protegida</b>!</div>";

    root().innerHTML = '<div class="lock-wrap"><div class="lock-card"><div class="icone">' + icon("lock") + "</div>" +
      "<h1>Missão de hoje registrada</h1>" + feedback +
      "<p>Você já confirmou sua missão de hoje. Amanhã você pode continuar criando sua rotina e se habituando a executar uma tarefa todo dia.</p>" +
      '<div class="contagem" id="contagem">--:--:--</div>' +
      '<a href="#dashboard?ver=1" class="btn btn-outline" style="margin-top:20px;">' + icon("chart") + " Acompanhar andamento</a></div></div>";
    if (novos.length) confeteRapido();
    const lim = u.locked_until;
    function upd() {
      let diff = Math.max(0, lim - Date.now());
      const h = String(Math.floor(diff / 3600000)).padStart(2, "0");
      const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2, "0");
      const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, "0");
      const el = document.getElementById("contagem"); if (el) el.textContent = h + ":" + m + ":" + s;
      if (diff <= 0) render();
    }
    upd(); setInterval(upd, 1000);
  }

  // ----------------------------- Concluído -----------------------------
  function viewConcluido(u, p) {
    p = p || plans().filter(x => x.usuario_id === u.id).sort((a, b) => b.id - a.id)[0];
    root().innerHTML = topbar(u, "dashboard") + '<main class="main">' +
      '<div class="acoes-card bloco" style="margin-top:30px;"><div class="missao-icone" style="color:var(--gold);background:#FBF6E7;">' + icon("chest") + "</div>" +
      '<div class="missao">Trilha de ' + p.dias_totais + " dias concluída</div>" +
      '<div class="missao-detalhe">Você fechou o ciclo de "' + esc(p.categoria) + '" com <strong>' + p.pontos + " pontos</strong>. Que constância!</div>" +
      '<div class="acoes-botoes"><a href="#planejamento" id="nova" class="btn btn-primary">' + icon("play") + " Montar nova trilha</a></div></div></main>" +
      '<canvas id="confetti"></canvas>';
    ligarTopbar(u);
    const nova = document.getElementById("nova");
    if (nova) nova.addEventListener("click", e => { e.preventDefault(); u.primeiro_acesso = true; salvarUsuario(u); go("planejamento"); });
    confete();
  }

  function confete() {
    const cv = document.getElementById("confetti"); if (!cv) return;
    const ctx = cv.getContext("2d");
    const rz = () => { cv.width = innerWidth; cv.height = innerHeight; }; rz(); addEventListener("resize", rz);
    const cores = ["#1A32CC", "#3355FF", "#0EA5E9", "#0E9E4B", "#C6890F"];
    const ps = Array.from({ length: 120 }, () => ({ x: Math.random() * cv.width, y: Math.random() * -cv.height, r: 5 + Math.random() * 6, c: cores[Math.floor(Math.random() * cores.length)], vy: 2 + Math.random() * 3, vx: -1.4 + Math.random() * 2.8, rot: Math.random() * Math.PI, vr: -.14 + Math.random() * .28 }));
    const t0 = performance.now();
    (function tick(t) {
      ctx.clearRect(0, 0, cv.width, cv.height);
      ps.forEach(p => { p.y += p.vy; p.x += p.vx; p.rot += p.vr; if (p.y > cv.height + 20) { p.y = -20; p.x = Math.random() * cv.width; } ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * .6); ctx.restore(); });
      if (t - t0 < 5500) requestAnimationFrame(tick); else ctx.clearRect(0, 0, cv.width, cv.height);
    })(t0);
  }

  function confeteRapido() {
    const cv = document.createElement("canvas");
    cv.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:70";
    document.body.appendChild(cv);
    const ctx = cv.getContext("2d");
    const rz = () => { cv.width = innerWidth; cv.height = innerHeight; }; rz(); addEventListener("resize", rz);
    const cores = ["#FF6A1A", "#FFC13B", "#0EA5E9", "#3355FF", "#0E9E4B"];
    const ps = Array.from({ length: 110 }, () => ({ x: Math.random() * innerWidth, y: Math.random() * -innerHeight, r: 5 + Math.random() * 6, c: cores[Math.floor(Math.random() * cores.length)], vy: 2.5 + Math.random() * 3, vx: -1.5 + Math.random() * 3, rot: Math.random() * Math.PI, vr: -.16 + Math.random() * .32 }));
    const t0 = performance.now();
    (function tick(t) {
      ctx.clearRect(0, 0, cv.width, cv.height);
      const fade = Math.max(0, 1 - Math.max(0, t - t0 - 3200) / 900);
      ps.forEach(p => { p.y += p.vy; p.x += p.vx; p.rot += p.vr; ctx.save(); ctx.globalAlpha = fade; ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * .6); ctx.restore(); });
      if (t - t0 < 4100) requestAnimationFrame(tick); else cv.remove();
    })(t0);
  }

  // ----------------------------- Animação fogo/gelo -----------------------------
  function animarFogo(congela) {
    const aviso = document.querySelector(".fogo-aviso"); if (!aviso) return;
    const fogo = aviso.querySelector(".fogo"), txt = aviso.querySelector(".txt");
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      fogo.classList.add("aceso"); if (congela) fogo.classList.add("congelando"); txt.classList.add("revelar"); return;
    }
    const modo = congela ? "neve" : "fogo";
    const cv = document.createElement("canvas");
    cv.style.cssText = "position:absolute;top:0;left:0;pointer-events:none;z-index:60";
    document.body.appendChild(cv);
    const ctx = cv.getContext("2d");
    const rz = () => { cv.width = document.documentElement.clientWidth; cv.height = Math.max(document.documentElement.scrollHeight, innerHeight); }; rz(); addEventListener("resize", rz);
    const r = fogo.getBoundingClientRect();
    const alvoX = r.left + scrollX + r.width / 2, alvoY = r.top + scrollY + r.height * .55;
    const rnd = (a, b) => a + Math.random() * (b - a), espalha = Math.min(innerWidth * .42, 340);
    const CF = ["#FFE08A", "#FFD24C", "#FF9F2E", "#FF6A1A", "#FFB347"], CN = ["#FFFFFF", "#EAF7FF", "#CDEBFF", "#A9D8FF"];
    function nova(i) {
      const b = { x: alvoX + rnd(-1, 1) * espalha, y: alvoY - rnd(60, 440), rot: rnd(0, 6.28), px: 0, py: 0, pousou: false, a: 1, escala: 1 };
      if (modo === "neve") return Object.assign(b, { tipo: "neve", vy: rnd(.7, 1.8), vx: rnd(-.3, .3), r: rnd(2.2, 4.6), c: CN[i % CN.length], spin: rnd(-.05, .05), swA: rnd(20, 48), swF: rnd(.4, 1.1), swP: rnd(0, 6.28), twF: rnd(2, 4), twP: rnd(0, 6.28) });
      return Object.assign(b, { tipo: "fogo", vy: rnd(1.4, 3), vx: rnd(-.4, .4), r: rnd(1.6, 4.2), c: CF[i % CF.length], spin: rnd(-.14, .14), swA: rnd(10, 34), swF: rnd(.7, 1.9), swP: rnd(0, 6.28), twF: rnd(3, 7), twP: rnd(0, 6.28), fagulha: Math.random() < .55 });
    }
    const N = modo === "neve" ? 44 : 58, parts = Array.from({ length: N }, (_, i) => nova(i));
    const t0 = performance.now(), T_ACENDER = 1250, T_CONGELAR = 2100, T_TEXTO = congela ? 3150 : 1780, T_EMITIR = congela ? 4200 : 3800, T_FIM = congela ? 5600 : 5200, FADE = 1000, T_SUMIR = T_FIM - FADE;
    let acendeu = false, congelou = false, revelou = false;
    function dFogo(p, x, y) { ctx.save(); ctx.translate(x, y); ctx.rotate(p.rot); ctx.scale(p.escala, p.escala); ctx.fillStyle = p.c; ctx.shadowColor = p.c; ctx.shadowBlur = 10; ctx.beginPath(); if (p.fagulha) { const w = p.r * 1.6, hh = p.r * .9, rr = hh / 2; ctx.moveTo(-w + rr, -hh); ctx.arcTo(w, -hh, w, hh, rr); ctx.arcTo(w, hh, -w, hh, rr); ctx.arcTo(-w, hh, -w, -hh, rr); ctx.arcTo(-w, -hh, w, -hh, rr); } else ctx.arc(0, 0, p.r, 0, 6.28); ctx.fill(); ctx.restore(); }
    function dNeve(p, x, y) { ctx.save(); ctx.translate(x, y); ctx.rotate(p.rot); ctx.strokeStyle = p.c; ctx.lineWidth = Math.max(1, p.r * .34); ctx.lineCap = "round"; ctx.shadowColor = p.c; ctx.shadowBlur = 6; for (let k = 0; k < 3; k++) { ctx.rotate(Math.PI / 3); ctx.beginPath(); ctx.moveTo(-p.r, 0); ctx.lineTo(p.r, 0); ctx.stroke(); } ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(0, 0, p.r * .28, 0, 6.28); ctx.fill(); ctx.restore(); }
    function frame(t) {
      const el = t - t0, ts = el / 1000; ctx.clearRect(0, 0, cv.width, cv.height);
      const fade = el < T_SUMIR ? 1 : Math.max(0, 1 - (el - T_SUMIR) / FADE);
      parts.forEach((p, i) => {
        if (p.a <= 0) { if (el < T_EMITIR) Object.assign(p, nova(i)); else return; }
        if (!p.pousou) {
          if (p.tipo === "neve") { p.vx += (alvoX - p.x) * .0003; p.vy += .014; } else { p.vx += (alvoX - p.x) * .0007; p.vy += .035; }
          p.x += p.vx; p.y += p.vy; p.rot += p.spin;
          if (p.y >= alvoY) { p.pousou = true; if (p.tipo === "fogo") p.escala = 1.5; }
        } else { p.a -= p.tipo === "neve" ? .03 : .05; if (p.tipo === "fogo") { p.escala += (1 - p.escala) * .2; p.y -= .3; } }
        const sway = p.swA * Math.sin(ts * p.swF + p.swP), dx = p.x + sway, dy = p.y;
        const alpha = Math.max(0, Math.min(1, p.a)) * (0.6 + 0.4 * Math.sin(ts * p.twF + p.twP)) * fade;
        if (p.tipo === "fogo" && p.px && !p.pousou) { ctx.globalAlpha = alpha * .35; ctx.strokeStyle = p.c; ctx.lineWidth = p.r * .9; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(p.px, p.py); ctx.lineTo(dx, dy); ctx.stroke(); }
        ctx.globalAlpha = alpha; if (p.tipo === "neve") dNeve(p, dx, dy); else dFogo(p, dx, dy);
        p.px = dx; p.py = dy;
      });
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;
      if (!acendeu && el >= T_ACENDER) { fogo.classList.add("aceso"); acendeu = true; }
      if (congela && !congelou && el >= T_CONGELAR) { fogo.classList.add("congelando"); congelou = true; }
      if (!revelou && el >= T_TEXTO) { txt.classList.add("revelar"); revelou = true; }
      if (el < T_FIM) requestAnimationFrame(frame); else cv.remove();
    }
    requestAnimationFrame(frame);
  }

  // ----------------------------- util -----------------------------
  function val(id) { const e = document.getElementById(id); return e ? e.value.trim() : ""; }

  // start
  if (!location.hash) location.hash = "#login";
  render();
})();
