"""
Habpt - aplicativo desktop de produtividade e formação de hábitos.
Backend Flask. Roda tanto em modo navegador (debug) quanto embutido numa janela
nativa via pywebview (ver executar.py), gerando um .exe autocontido com PyInstaller.
"""
from flask import Flask, render_template, request, redirect, url_for, session, flash, jsonify
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime, date, timedelta
import os
import sys
import re
import calendar as calmod

import database as db


def caminho_recurso(*partes):
    """Resolve caminhos de templates/static tanto rodando .py quanto empacotado (.exe)."""
    if getattr(sys, "frozen", False):
        base = getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
    else:
        base = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base, *partes)


app = Flask(
    __name__,
    template_folder=caminho_recurso("templates"),
    static_folder=caminho_recurso("static"),
)
app.secret_key = os.environ.get("SECRET_KEY", "dev-inseguro-troque-em-producao")  # em produção use a env SECRET_KEY

db.iniciar_banco()

# Administradores do app (podem recomeçar a qualquer momento). Aplicado na inicialização.
ADMIN_EMAILS = {"joabeealvez@gmail.com"}
for _email in ADMIN_EMAILS:
    db.definir_admin_por_email(_email, 1)

EMAIL_REGEX = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


# ---------------- Helpers ----------------

def usuario_logado():
    uid = session.get("usuario_id")
    if not uid:
        return None
    return db.buscar_usuario_por_id(uid)


def proxima_meia_noite():
    hoje = datetime.now()
    amanha = (hoje + timedelta(days=1)).date()
    return datetime.combine(amanha, datetime.min.time())


def esta_travado(usuario):
    if not usuario.get("locked_until"):
        return False
    limite = datetime.fromisoformat(usuario["locked_until"])
    return datetime.now() < limite


@app.context_processor
def injetar_usuario():
    return {"usuario_atual": usuario_logado()}


# ---------------- Cadastro / Login ----------------

@app.route("/", methods=["GET"])
def raiz():
    if usuario_logado():
        return redirect(url_for("dashboard"))
    return redirect(url_for("login"))


@app.route("/cadastro", methods=["GET", "POST"])
def cadastro():
    if request.method == "GET":
        return render_template("cadastro.html")

    nome = request.form.get("nome", "").strip()
    numero = request.form.get("numero", "").strip()
    email = request.form.get("email", "").strip()
    senha = request.form.get("senha", "")
    confirmar_senha = request.form.get("confirmar_senha", "")
    idade_raw = request.form.get("idade", "").strip()

    erros = []
    if not nome:
        erros.append("Informe seu nome.")
    if not numero:
        erros.append("Informe um número de telefone.")
    if not EMAIL_REGEX.match(email):
        erros.append("Informe um e-mail válido.")
    if len(senha) < 6:
        erros.append("A senha precisa ter pelo menos 6 caracteres.")
    if senha != confirmar_senha:
        erros.append("A confirmação de senha não bate com a senha.")
    if not idade_raw.isdigit() or not (10 <= int(idade_raw) <= 120):
        erros.append("Informe uma idade válida.")
    elif db.buscar_usuario_por_email(email):
        erros.append("Já existe uma conta com este e-mail.")

    if erros:
        for e in erros:
            flash(e, "erro")
        return render_template("cadastro.html", nome=nome, numero=numero, email=email, idade=idade_raw)

    senha_hash = generate_password_hash(senha)
    usuario_id = db.criar_usuario(nome, numero, email, senha_hash, int(idade_raw))
    if email.lower().strip() in ADMIN_EMAILS:
        db.definir_admin(usuario_id, 1)
    session["usuario_id"] = usuario_id
    flash("Conta criada! Vamos montar seu planejamento.", "sucesso")
    return redirect(url_for("montar_plano"))


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "GET":
        return render_template("login.html")

    email = request.form.get("email", "").strip()
    senha = request.form.get("senha", "")
    usuario = db.buscar_usuario_por_email(email)

    if not usuario or not check_password_hash(usuario["senha_hash"], senha):
        flash("E-mail ou senha incorretos.", "erro")
        return render_template("login.html", email=email)

    if usuario["email"] in ADMIN_EMAILS and not usuario.get("admin"):
        db.definir_admin(usuario["id"], 1)

    session["usuario_id"] = usuario["id"]

    if usuario["primeiro_acesso"]:
        return redirect(url_for("montar_plano"))
    return redirect(url_for("dashboard"))


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


# ---------------- Planejamento (primeiro acesso) ----------------

@app.route("/planejamento", methods=["GET", "POST"])
def montar_plano():
    usuario = usuario_logado()
    if not usuario:
        return redirect(url_for("login"))

    if request.method == "GET":
        return render_template("planejamento.html", categorias=db.CATEGORIAS)

    categoria = request.form.get("categoria", "").strip()
    tempo = request.form.get("tempo_por_dia", "").strip()
    vezes = request.form.get("vezes_por_dia", "").strip()

    erros = []
    if categoria not in db.CATEGORIAS:
        erros.append("Escolha uma categoria de atividade.")
    if not tempo.isdigit() or int(tempo) <= 0:
        erros.append("Informe um tempo por dia válido (em minutos).")
    if not vezes.isdigit() or int(vezes) <= 0:
        erros.append("Informe quantas vezes ao dia pretende praticar.")

    if erros:
        for e in erros:
            flash(e, "erro")
        return render_template("planejamento.html", categorias=db.CATEGORIAS)

    db.criar_plano(usuario["id"], categoria, int(tempo), int(vezes))
    db.marcar_primeiro_acesso_concluido(usuario["id"])
    flash("Planejamento criado! Sua trilha de 40 dias começa hoje.", "sucesso")
    return redirect(url_for("dashboard"))


# ---------------- Dashboard ----------------

@app.route("/dashboard")
def dashboard():
    usuario = usuario_logado()
    if not usuario:
        return redirect(url_for("login"))

    if usuario["primeiro_acesso"]:
        return redirect(url_for("montar_plano"))

    travado = esta_travado(usuario)
    limite = datetime.fromisoformat(usuario["locked_until"]) if usuario.get("locked_until") else None

    plano = db.buscar_plano_ativo(usuario["id"])
    if not plano:
        return redirect(url_for("montar_plano"))

    dia_numero = db.dia_atual_do_plano(plano)
    if dia_numero > plano["dias_totais"]:
        db.concluir_plano(plano["id"])
        return render_template("concluido.html", plano=plano)

    registro_hoje = db.ja_registrou_hoje(plano["id"], dia_numero)
    historico = db.historico_do_plano(plano["id"])
    eng = calcular_engajamento(historico)

    # Bloqueado: por padrão mostra a tela de bloqueio (com feedback de ofensiva); ?ver=1 = só-leitura.
    if travado and not request.args.get("ver"):
        antes = calcular_engajamento([h for h in historico if h["dia_numero"] != dia_numero])
        novos_marcos = [m for m in eng["marcos"] if m not in antes["marcos"]]
        protegido = bool(registro_hoje and registro_hoje["status"] == "falha"
                         and eng["ofensiva"] == antes["ofensiva"] and eng["ofensiva"] > 0)
        return render_template("travado.html", limite=limite, eng=eng,
                               novos_marcos=novos_marcos, protegido=protegido)

    trilha = montar_trilha(plano, dia_numero, historico)

    cumpridas_total = sum(1 for h in historico if h["status"] == "cumprida")
    falhas_total = sum(1 for h in historico if h["status"] == "falha")
    sequencia = sequencia_atual(historico)
    pct = round((dia_numero - 1) / plano["dias_totais"] * 100)
    calendario = montar_calendario(plano, historico)

    return render_template(
        "dashboard.html",
        plano=plano,
        dia_numero=dia_numero,
        registro_hoje=registro_hoje,
        trilha=trilha,
        cumpridas_total=cumpridas_total,
        falhas_total=falhas_total,
        sequencia=sequencia,
        eng=eng,
        frase_dia=frase_do_dia(),
        pct=pct,
        calendario=calendario,
        travado=travado,
        limite=limite,
    )


MESES_PT = [
    "janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
]


def montar_calendario(plano, historico):
    """Grade do mês atual, marcando os dias que caem dentro da trilha e seu status."""
    hoje = date.today()
    inicio = date.fromisoformat(plano["data_inicio"])
    fim = inicio + timedelta(days=plano["dias_totais"] - 1)
    status_por_dia = {h["dia_numero"]: h["status"] for h in historico}

    cal = calmod.Calendar(firstweekday=0)  # segunda-feira
    semanas = []
    for semana in cal.monthdatescalendar(hoje.year, hoje.month):
        linha = []
        for d in semana:
            estado = "fora" if d.month != hoje.month else "vazio"
            if inicio <= d <= fim:
                dia_num = (d - inicio).days + 1
                if dia_num in status_por_dia:
                    estado = status_por_dia[dia_num]      # cumprida / falha
                elif d == hoje:
                    estado = "hoje"
                elif d < hoje:
                    estado = "falha"
                else:
                    estado = "futuro"
            linha.append({"dia": d.day, "estado": estado, "hoje": d == hoje})
        semanas.append(linha)

    return {
        "semanas": semanas,
        "titulo": f"{MESES_PT[hoje.month - 1].capitalize()} de {hoje.year}",
        "dow": ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"],
    }


def sequencia_atual(historico):
    """Maior sequência de 'cumprida' terminando no último dia registrado."""
    seq = 0
    for h in sorted(historico, key=lambda x: x["dia_numero"]):
        if h["status"] == "cumprida":
            seq += 1
        else:
            seq = 0
    return seq


# ---------------- Engajamento (ofensiva / marcos / congeladores) ----------------

MARCOS = [3, 7, 14, 30, 40]
CAP_CONGELADORES = 3
GANHA_A_CADA = 5

FRASES = [
    "Um dia de cada vez constrói o hábito.", "Constância vence intensidade.",
    "Você contra você de ontem.", "Pequenos passos, grandes trilhas.",
    "O hábito nasce da repetição.", "Hoje conta — não quebre a corrente.",
    "Disciplina é liberdade.", "Cada dia cumprido é um tijolo na sua rotina.",
    "A ofensiva mais forte é a que você mantém.", "Foco no processo; o resultado vem.",
    "Comece agora, o futuro agradece.", "40 dias. Um de cada vez.",
]


def frase_do_dia():
    return FRASES[date.today().timetuple().tm_yday % len(FRASES)]


def calcular_engajamento(historico):
    """Deriva ofensiva, melhor, congeladores e marcos a partir do histórico ordenado.
    Um congelador é ganho a cada N cumpridas e protege a ofensiva numa falha."""
    streak = melhor = freezes = cumpridas = 0
    for h in sorted(historico, key=lambda x: x["dia_numero"]):
        if h["status"] == "cumprida":
            streak += 1
            cumpridas += 1
            if cumpridas % GANHA_A_CADA == 0 and freezes < CAP_CONGELADORES:
                freezes += 1
            melhor = max(melhor, streak)
        else:
            if freezes > 0:
                freezes -= 1
            else:
                streak = 0
    marcos = [m for m in MARCOS if melhor >= m]
    return {"ofensiva": streak, "melhor": melhor, "congeladores": freezes,
            "marcos": marcos, "cumpridas": cumpridas}


def cor_gradiente(i, total):
    """Interpola do laranja (início) ao verde (meta), passo a passo pelo anel."""
    laranja = (245, 137, 31)
    verde = (31, 157, 87)
    f = i / total if total else 0
    r = round(laranja[0] + (verde[0] - laranja[0]) * f)
    g = round(laranja[1] + (verde[1] - laranja[1]) * f)
    b = round(laranja[2] + (verde[2] - laranja[2]) * f)
    return f"#{r:02X}{g:02X}{b:02X}"


def montar_trilha(plano, dia_atual, historico):
    """Cada marco = um dia real da trilha, posicionado num anel e colorido no gradiente."""
    dias_totais = plano["dias_totais"]
    inicio = date.fromisoformat(plano["data_inicio"])
    status_por_dia = {h["dia_numero"]: h["status"] for h in historico}
    trilha = []
    for d in range(1, dias_totais + 1):
        if d in status_por_dia:
            estado = status_por_dia[d]
        elif d == dia_atual:
            estado = "hoje"
        elif d < dia_atual:
            estado = "falha"  # dia passou sem registro (não deveria acontecer, trava evita)
        else:
            estado = "futuro"
        data_d = inicio + timedelta(days=d - 1)
        trilha.append({
            "dia": d,                                   # nº do dia na trilha (1..40)
            "label": data_d.day,                        # dia do mês real (21, 22, 23...)
            "data_iso": data_d.isoformat(),
            "estado": estado,
            "cor": cor_gradiente(d - 1, dias_totais - 1),
            "angulo": round((d - 1) / dias_totais * 360, 2),
        })
    return trilha


@app.route("/foco")
def foco():
    usuario = usuario_logado()
    if not usuario:
        return redirect(url_for("login"))

    if esta_travado(usuario):
        return redirect(url_for("dashboard"))

    plano = db.buscar_plano_ativo(usuario["id"])
    if not plano:
        return redirect(url_for("montar_plano"))

    dia_numero = db.dia_atual_do_plano(plano)
    if dia_numero > plano["dias_totais"]:
        return redirect(url_for("dashboard"))

    if db.ja_registrou_hoje(plano["id"], dia_numero):
        return redirect(url_for("dashboard"))

    total_segundos = plano["tempo_por_dia_min"] * 60
    return render_template(
        "foco.html",
        plano=plano,
        dia_numero=dia_numero,
        total_segundos=total_segundos,
    )


@app.route("/recomecar", methods=["POST"])
def recomecar():
    usuario = usuario_logado()
    if not usuario:
        return redirect(url_for("login"))
    if not usuario.get("admin"):
        flash("Apenas administradores podem recomeçar a qualquer momento.", "erro")
        return redirect(url_for("dashboard"))

    db.resetar_usuario(usuario["id"])
    flash("Status resetado! Monte sua nova trilha.", "sucesso")
    return redirect(url_for("montar_plano"))


@app.route("/acao/<tipo>", methods=["POST"])
def registrar_acao(tipo):
    usuario = usuario_logado()
    if not usuario:
        return redirect(url_for("login"))

    if esta_travado(usuario):
        return redirect(url_for("dashboard"))

    if tipo not in ("cumprida", "falha"):
        return redirect(url_for("dashboard"))

    plano = db.buscar_plano_ativo(usuario["id"])
    if not plano:
        return redirect(url_for("montar_plano"))

    dia_numero = db.dia_atual_do_plano(plano)
    if dia_numero > plano["dias_totais"]:
        db.concluir_plano(plano["id"])
        return redirect(url_for("dashboard"))

    if not db.ja_registrou_hoje(plano["id"], dia_numero):
        db.registrar_dia(plano["id"], dia_numero, tipo)

    limite = proxima_meia_noite()
    db.definir_trava(usuario["id"], limite.isoformat())

    return redirect(url_for("dashboard"))


# ---------------- Histórico ----------------

@app.route("/historico")
def historico():
    usuario = usuario_logado()
    if not usuario:
        return redirect(url_for("login"))

    plano = db.buscar_plano_ativo(usuario["id"])
    if not plano:
        return redirect(url_for("montar_plano"))

    cumpridas, falhas = db.cumpridas_e_falhas(plano["id"])
    return render_template("historico.html", plano=plano, cumpridas=cumpridas, falhas=falhas)


if __name__ == "__main__":
    app.run(debug=True, port=5000)
