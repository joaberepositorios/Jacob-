# Rodar com Supabase (Postgres) — passo a passo

O app tem **backend duplo** (ver `database.py`):

- **Sem** a variável `DATABASE_URL` → usa **SQLite** local (`habitrilha.db`). É o modo do `.exe` desktop e do desenvolvimento.
- **Com** `DATABASE_URL` definida → usa **PostgreSQL do Supabase** (dados persistentes).

As tabelas são criadas **automaticamente** na primeira execução (`iniciar_banco()`), então você **não precisa** rodar SQL manual no Supabase.

---

## 1. Criar o projeto no Supabase

1. Acesse https://supabase.com e crie uma conta (login com GitHub).
2. **New project** → escolha um nome, defina uma **senha do banco** (guarde-a) e a região mais próxima (ex.: *South America (São Paulo)*).
3. Aguarde ~1–2 min o projeto provisionar.

## 2. Pegar a Connection String

1. No projeto: **Project Settings** (engrenagem) → **Database**.
2. Em **Connection string**, escolha a aba **URI**.
3. Selecione o modo **Transaction pooler** (porta **6543**) — é o ideal para apps web que abrem/fecham conexões a cada requisição (como este).
4. Copie a string. Ela se parece com:

   ```
   postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-sa-east-1.pooler.supabase.com:6543/postgres
   ```

5. Troque `[YOUR-PASSWORD]` pela senha do banco (passo 1).

> O código adiciona `sslmode=require` sozinho, e aceita tanto `postgres://` quanto `postgresql://`.

## 3. Configurar no Render

Se você já fez o deploy pelo `render.yaml`:

1. No painel do Render, abra o serviço **habitrilha** → **Environment**.
2. Adicione a variável:
   - **Key:** `DATABASE_URL`
   - **Value:** a connection string do passo 2 (com a senha)
3. **Save changes** → o Render faz um **redeploy**. No boot, o app cria as tabelas no Supabase.

Pronto: os dados agora **persistem** entre reinícios/redeploys.

## 4. Testar localmente com Supabase (opcional)

No Windows (PowerShell), na pasta do projeto:

```powershell
pip install "psycopg[binary]"
$env:DATABASE_URL = "postgresql://postgres.xxxx:SENHA@aws-0-...pooler.supabase.com:6543/postgres"
python app.py
```

Abra http://127.0.0.1:5000 — agora ele lê/grava no Supabase. Para voltar ao SQLite,
feche o terminal (ou `Remove-Item Env:\DATABASE_URL`) e rode `python app.py` de novo.

---

## Observações

- **Admin (joabe):** ao cadastrar/entrar com `joabeealvez@gmail.com`, a conta vira admin automaticamente (ver `ADMIN_EMAILS` em `app.py`).
- **Segurança:** a `DATABASE_URL` (com senha) fica só nas variáveis de ambiente do Render — **nunca** no repositório. O `render.yaml` usa `sync: false`, ou seja, o valor é preenchido no painel, não no arquivo.
- **`.exe` desktop:** continua 100% offline em SQLite — não precisa de Supabase nem internet.
- **Ver conexões/dados:** no Supabase, use **Table Editor** (tabelas `usuarios`, `planos`, `registros_diarios`) ou o **SQL Editor**.
