"""
Camada de acesso a dados do Habpt.

Backend duplo (mesma API para o app.py):
- Se a variável de ambiente DATABASE_URL existir  -> PostgreSQL (Supabase).
- Caso contrário                                  -> SQLite local (.exe / dev).

Escolha automática: em produção (Render + Supabase) basta definir DATABASE_URL.
Localmente, sem essa variável, tudo continua no arquivo habitrilha.db (SQLite).
"""
import os
import sys
from datetime import datetime, date

DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
USA_PG = bool(DATABASE_URL)

if USA_PG:
    import psycopg
    from psycopg.rows import dict_row
    # psycopg usa o esquema 'postgresql://'. Normaliza e garante SSL (Supabase exige).
    if DATABASE_URL.startswith("postgres://"):
        DATABASE_URL = "postgresql://" + DATABASE_URL[len("postgres://"):]
    if "sslmode=" not in DATABASE_URL:
        DATABASE_URL += ("&" if "?" in DATABASE_URL else "?") + "sslmode=require"
else:
    import sqlite3


def caminho_banco():
    """Caminho do SQLite ao lado do executável/script (só usado no modo SQLite)."""
    if getattr(sys, "frozen", False):
        base = os.path.dirname(sys.executable)
    else:
        base = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base, "habitrilha.db")

DB_PATH = caminho_banco()

DIAS_TOTAIS_PADRAO = 40

CATEGORIAS = [
    "Organização pessoal",
    "Organização de residência",
    "Organização acadêmica",
    "Estudo",
    "Leitura",
    "Entretenimento",
    "Finanças pessoais",
    "Trabalho / carreira",
    "Outro",
]


# ---------- Conexão / helpers de portabilidade ----------

def conectar():
    if USA_PG:
        return psycopg.connect(DATABASE_URL, row_factory=dict_row)
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


def _ex(con, sql, params=()):
    """Executa traduzindo os placeholders '?' -> '%s' quando for Postgres."""
    if USA_PG:
        sql = sql.replace("?", "%s")
    return con.execute(sql, params)


def _inserir(con, sql, params):
    """INSERT retornando o id gerado (RETURNING no Postgres, lastrowid no SQLite)."""
    if USA_PG:
        return _ex(con, sql + " RETURNING id", params).fetchone()["id"]
    return _ex(con, sql, params).lastrowid


def iniciar_banco():
    id_col = "SERIAL PRIMARY KEY" if USA_PG else "INTEGER PRIMARY KEY AUTOINCREMENT"
    tabelas = [
        f"""CREATE TABLE IF NOT EXISTS usuarios (
            id {id_col},
            nome TEXT NOT NULL,
            numero TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            senha_hash TEXT NOT NULL,
            idade INTEGER NOT NULL,
            primeiro_acesso INTEGER NOT NULL DEFAULT 1,
            locked_until TEXT,
            admin INTEGER NOT NULL DEFAULT 0,
            criado_em TEXT NOT NULL
        )""",
        f"""CREATE TABLE IF NOT EXISTS planos (
            id {id_col},
            usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
            categoria TEXT NOT NULL,
            tempo_por_dia_min INTEGER NOT NULL,
            vezes_por_dia INTEGER NOT NULL,
            dias_totais INTEGER NOT NULL DEFAULT 40,
            data_inicio TEXT NOT NULL,
            pontos INTEGER NOT NULL DEFAULT 0,
            ativo INTEGER NOT NULL DEFAULT 1,
            concluido INTEGER NOT NULL DEFAULT 0
        )""",
        f"""CREATE TABLE IF NOT EXISTS registros_diarios (
            id {id_col},
            plano_id INTEGER NOT NULL REFERENCES planos(id),
            dia_numero INTEGER NOT NULL,
            data TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('cumprida', 'falha')),
            registrado_em TEXT NOT NULL,
            UNIQUE (plano_id, dia_numero)
        )""",
    ]
    con = conectar()
    try:
        for ddl in tabelas:
            con.execute(ddl)
        # Migração: garante a coluna admin em bancos já existentes.
        if USA_PG:
            con.execute("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS admin INTEGER NOT NULL DEFAULT 0")
        else:
            cols = [r[1] for r in con.execute("PRAGMA table_info(usuarios)")]
            if "admin" not in cols:
                con.execute("ALTER TABLE usuarios ADD COLUMN admin INTEGER NOT NULL DEFAULT 0")
        con.commit()
    finally:
        con.close()


# ---------- Usuários ----------

def criar_usuario(nome, numero, email, senha_hash, idade):
    con = conectar()
    try:
        uid = _inserir(
            con,
            "INSERT INTO usuarios (nome, numero, email, senha_hash, idade, primeiro_acesso, criado_em) "
            "VALUES (?, ?, ?, ?, ?, 1, ?)",
            (nome, numero, email.lower().strip(), senha_hash, idade, datetime.now().isoformat()),
        )
        con.commit()
        return uid
    finally:
        con.close()


def buscar_usuario_por_email(email):
    con = conectar()
    try:
        row = _ex(con, "SELECT * FROM usuarios WHERE email = ?", (email.lower().strip(),)).fetchone()
        return dict(row) if row else None
    finally:
        con.close()


def buscar_usuario_por_id(usuario_id):
    con = conectar()
    try:
        row = _ex(con, "SELECT * FROM usuarios WHERE id = ?", (usuario_id,)).fetchone()
        return dict(row) if row else None
    finally:
        con.close()


def marcar_primeiro_acesso_concluido(usuario_id):
    con = conectar()
    try:
        _ex(con, "UPDATE usuarios SET primeiro_acesso = 0 WHERE id = ?", (usuario_id,))
        con.commit()
    finally:
        con.close()


def definir_trava(usuario_id, locked_until_iso):
    con = conectar()
    try:
        _ex(con, "UPDATE usuarios SET locked_until = ? WHERE id = ?", (locked_until_iso, usuario_id))
        con.commit()
    finally:
        con.close()


def definir_admin(usuario_id, valor=1):
    con = conectar()
    try:
        _ex(con, "UPDATE usuarios SET admin = ? WHERE id = ?", (1 if valor else 0, usuario_id))
        con.commit()
    finally:
        con.close()


def definir_admin_por_email(email, valor=1):
    con = conectar()
    try:
        _ex(con, "UPDATE usuarios SET admin = ? WHERE email = ?", (1 if valor else 0, email.lower().strip()))
        con.commit()
    finally:
        con.close()


def resetar_usuario(usuario_id):
    """Zera o status para recomeçar: destrava e desativa o(s) plano(s) ativo(s)."""
    con = conectar()
    try:
        _ex(con, "UPDATE usuarios SET locked_until = NULL WHERE id = ?", (usuario_id,))
        _ex(con, "UPDATE planos SET ativo = 0 WHERE usuario_id = ? AND ativo = 1", (usuario_id,))
        con.commit()
    finally:
        con.close()


# ---------- Planos ----------

def criar_plano(usuario_id, categoria, tempo_por_dia_min, vezes_por_dia, dias_totais=DIAS_TOTAIS_PADRAO):
    con = conectar()
    try:
        pid = _inserir(
            con,
            "INSERT INTO planos (usuario_id, categoria, tempo_por_dia_min, vezes_por_dia, dias_totais, "
            "data_inicio, pontos, ativo, concluido) VALUES (?, ?, ?, ?, ?, ?, 0, 1, 0)",
            (usuario_id, categoria, tempo_por_dia_min, vezes_por_dia, dias_totais, date.today().isoformat()),
        )
        con.commit()
        return pid
    finally:
        con.close()


def buscar_plano_ativo(usuario_id):
    con = conectar()
    try:
        row = _ex(
            con,
            "SELECT * FROM planos WHERE usuario_id = ? AND ativo = 1 ORDER BY id DESC LIMIT 1",
            (usuario_id,),
        ).fetchone()
        return dict(row) if row else None
    finally:
        con.close()


def listar_planos(usuario_id):
    con = conectar()
    try:
        rows = _ex(con, "SELECT * FROM planos WHERE usuario_id = ? ORDER BY id DESC", (usuario_id,)).fetchall()
        return [dict(r) for r in rows]
    finally:
        con.close()


def concluir_plano(plano_id):
    con = conectar()
    try:
        _ex(con, "UPDATE planos SET ativo = 0, concluido = 1 WHERE id = ?", (plano_id,))
        con.commit()
    finally:
        con.close()


def dia_atual_do_plano(plano):
    """Número do dia (1..dias_totais) correspondente a hoje, baseado na data de início."""
    inicio = date.fromisoformat(plano["data_inicio"])
    delta = (date.today() - inicio).days + 1
    return max(1, delta)


def ja_registrou_hoje(plano_id, dia_numero):
    con = conectar()
    try:
        row = _ex(
            con,
            "SELECT * FROM registros_diarios WHERE plano_id = ? AND dia_numero = ?",
            (plano_id, dia_numero),
        ).fetchone()
        return dict(row) if row else None
    finally:
        con.close()


def registrar_dia(plano_id, dia_numero, status):
    """status: 'cumprida' ou 'falha'. Atualiza pontos do plano (+1 / -1)."""
    con = conectar()
    try:
        _ex(
            con,
            "INSERT INTO registros_diarios (plano_id, dia_numero, data, status, registrado_em) "
            "VALUES (?, ?, ?, ?, ?) "
            "ON CONFLICT (plano_id, dia_numero) DO UPDATE SET "
            "data = excluded.data, status = excluded.status, registrado_em = excluded.registrado_em",
            (plano_id, dia_numero, date.today().isoformat(), status, datetime.now().isoformat()),
        )
        delta = 1 if status == "cumprida" else -1
        _ex(con, "UPDATE planos SET pontos = pontos + ? WHERE id = ?", (delta, plano_id))
        con.commit()
    finally:
        con.close()


def historico_do_plano(plano_id):
    con = conectar()
    try:
        rows = _ex(
            con,
            "SELECT * FROM registros_diarios WHERE plano_id = ? ORDER BY dia_numero ASC",
            (plano_id,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        con.close()


def cumpridas_e_falhas(plano_id):
    con = conectar()
    try:
        cumpridas = _ex(
            con,
            "SELECT * FROM registros_diarios WHERE plano_id = ? AND status = 'cumprida' ORDER BY dia_numero",
            (plano_id,),
        ).fetchall()
        falhas = _ex(
            con,
            "SELECT * FROM registros_diarios WHERE plano_id = ? AND status = 'falha' ORDER BY dia_numero",
            (plano_id,),
        ).fetchall()
        return [dict(r) for r in cumpridas], [dict(r) for r in falhas]
    finally:
        con.close()
