"""
Camada de acesso a dados do HabiTrilha.
Usa SQLite puro (sem ORM) para manter o .exe final leve e sem dependências extras.
"""
import sqlite3
import os
import sys
from datetime import datetime, date, timedelta

def caminho_banco():
    """Garante que o banco fique ao lado do executável (funciona rodando .py ou .exe)."""
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
    "Saúde e exercício",
    "Finanças pessoais",
    "Trabalho / carreira",
    "Outro",
]


def conectar():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


def iniciar_banco():
    con = conectar()
    cur = con.cursor()
    cur.executescript(
        """
        CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            numero TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            senha_hash TEXT NOT NULL,
            idade INTEGER NOT NULL,
            primeiro_acesso INTEGER NOT NULL DEFAULT 1,
            locked_until TEXT,
            criado_em TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS planos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario_id INTEGER NOT NULL,
            categoria TEXT NOT NULL,
            tempo_por_dia_min INTEGER NOT NULL,
            vezes_por_dia INTEGER NOT NULL,
            dias_totais INTEGER NOT NULL DEFAULT 40,
            data_inicio TEXT NOT NULL,
            pontos INTEGER NOT NULL DEFAULT 0,
            ativo INTEGER NOT NULL DEFAULT 1,
            concluido INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        );

        CREATE TABLE IF NOT EXISTS registros_diarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            plano_id INTEGER NOT NULL,
            dia_numero INTEGER NOT NULL,
            data TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('cumprida', 'falha')),
            registrado_em TEXT NOT NULL,
            FOREIGN KEY (plano_id) REFERENCES planos(id),
            UNIQUE (plano_id, dia_numero)
        );
        """
    )
    con.commit()
    con.close()


# ---------- Usuários ----------

def criar_usuario(nome, numero, email, senha_hash, idade):
    con = conectar()
    try:
        cur = con.execute(
            "INSERT INTO usuarios (nome, numero, email, senha_hash, idade, primeiro_acesso, criado_em) "
            "VALUES (?, ?, ?, ?, ?, 1, ?)",
            (nome, numero, email.lower().strip(), senha_hash, idade, datetime.now().isoformat()),
        )
        con.commit()
        return cur.lastrowid
    finally:
        con.close()


def buscar_usuario_por_email(email):
    con = conectar()
    try:
        row = con.execute(
            "SELECT * FROM usuarios WHERE email = ?", (email.lower().strip(),)
        ).fetchone()
        return dict(row) if row else None
    finally:
        con.close()


def buscar_usuario_por_id(usuario_id):
    con = conectar()
    try:
        row = con.execute("SELECT * FROM usuarios WHERE id = ?", (usuario_id,)).fetchone()
        return dict(row) if row else None
    finally:
        con.close()


def marcar_primeiro_acesso_concluido(usuario_id):
    con = conectar()
    try:
        con.execute("UPDATE usuarios SET primeiro_acesso = 0 WHERE id = ?", (usuario_id,))
        con.commit()
    finally:
        con.close()


def definir_trava(usuario_id, locked_until_iso):
    con = conectar()
    try:
        con.execute("UPDATE usuarios SET locked_until = ? WHERE id = ?", (locked_until_iso, usuario_id))
        con.commit()
    finally:
        con.close()


# ---------- Planos ----------

def criar_plano(usuario_id, categoria, tempo_por_dia_min, vezes_por_dia, dias_totais=DIAS_TOTAIS_PADRAO):
    con = conectar()
    try:
        cur = con.execute(
            "INSERT INTO planos (usuario_id, categoria, tempo_por_dia_min, vezes_por_dia, dias_totais, "
            "data_inicio, pontos, ativo, concluido) VALUES (?, ?, ?, ?, ?, ?, 0, 1, 0)",
            (usuario_id, categoria, tempo_por_dia_min, vezes_por_dia, dias_totais, date.today().isoformat()),
        )
        con.commit()
        return cur.lastrowid
    finally:
        con.close()


def buscar_plano_ativo(usuario_id):
    con = conectar()
    try:
        row = con.execute(
            "SELECT * FROM planos WHERE usuario_id = ? AND ativo = 1 ORDER BY id DESC LIMIT 1",
            (usuario_id,),
        ).fetchone()
        return dict(row) if row else None
    finally:
        con.close()


def listar_planos(usuario_id):
    con = conectar()
    try:
        rows = con.execute(
            "SELECT * FROM planos WHERE usuario_id = ? ORDER BY id DESC", (usuario_id,)
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        con.close()


def concluir_plano(plano_id):
    con = conectar()
    try:
        con.execute("UPDATE planos SET ativo = 0, concluido = 1 WHERE id = ?", (plano_id,))
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
        row = con.execute(
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
        con.execute(
            "INSERT OR REPLACE INTO registros_diarios (id, plano_id, dia_numero, data, status, registrado_em) "
            "VALUES ((SELECT id FROM registros_diarios WHERE plano_id = ? AND dia_numero = ?), ?, ?, ?, ?, ?)",
            (plano_id, dia_numero, plano_id, dia_numero, date.today().isoformat(), status, datetime.now().isoformat()),
        )
        delta = 1 if status == "cumprida" else -1
        con.execute("UPDATE planos SET pontos = pontos + ? WHERE id = ?", (delta, plano_id))
        con.commit()
    finally:
        con.close()


def historico_do_plano(plano_id):
    con = conectar()
    try:
        rows = con.execute(
            "SELECT * FROM registros_diarios WHERE plano_id = ? ORDER BY dia_numero ASC",
            (plano_id,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        con.close()


def cumpridas_e_falhas(plano_id):
    con = conectar()
    try:
        cumpridas = con.execute(
            "SELECT * FROM registros_diarios WHERE plano_id = ? AND status = 'cumprida' ORDER BY dia_numero",
            (plano_id,),
        ).fetchall()
        falhas = con.execute(
            "SELECT * FROM registros_diarios WHERE plano_id = ? AND status = 'falha' ORDER BY dia_numero",
            (plano_id,),
        ).fetchall()
        return [dict(r) for r in cumpridas], [dict(r) for r in falhas]
    finally:
        con.close()
