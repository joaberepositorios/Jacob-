# Estrutura do aplicativo ReHabto: uma análise da organização em código

## Resumo

O ReHabto é um aplicativo de formação de hábitos que estrutura uma "trilha" de 40
dias consecutivos de uma mesma tarefa. Este texto descreve, em nível introdutório, a
organização do seu código-fonte, destacando a separação em camadas, a estratégia de
persistência com dois backends intercambiáveis, a lógica de domínio derivada de dados
e a existência de duas frentes de execução — uma aplicação servidora (Flask) e uma
versão estática client-side. O objetivo é evidenciar decisões de projeto que favorecem
portabilidade, baixo acoplamento e reprodutibilidade.

## 1. Arquitetura geral

O sistema adota uma arquitetura em **três camadas** clássicas, com fronteiras explícitas:

1. **Persistência** (`database.py`): acesso a dados encapsulado em funções puras de
   consulta/escrita, sem regras de negócio.
2. **Domínio e controle** (`app.py`): rotas HTTP (Flask), validação de entrada e as
   regras do hábito (dia atual da trilha, travamento diário, engajamento).
3. **Apresentação** (`templates/*.html` + `static/css/style.css`): renderização via
   *template engine* Jinja2 e folha de estilo única.

A comunicação entre camadas é unidirecional (apresentação → controle → dados), o que
mantém o domínio independente da interface e do mecanismo de armazenamento.

## 2. Persistência com backend duplo

A camada de dados é agnóstica ao SGBD. Um único módulo seleciona, em tempo de
importação, entre **SQLite** (local, para o executável desktop e desenvolvimento) e
**PostgreSQL** (nuvem, via Supabase), conforme a variável de ambiente `DATABASE_URL`:

```python
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
USA_PG = bool(DATABASE_URL)
```

A portabilidade das instruções SQL é obtida por dois auxiliares que abstraem as
diferenças de dialeto (marcadores de parâmetro e recuperação de chave gerada):

```python
def _ex(con, sql, params=()):
    if USA_PG:
        sql = sql.replace("?", "%s")   # '?' (SQLite) -> '%s' (psycopg)
    return con.execute(sql, params)

def _inserir(con, sql, params):
    if USA_PG:
        return _ex(con, sql + " RETURNING id", params).fetchone()["id"]
    return _ex(con, sql, params).lastrowid   # lastrowid no SQLite
```

Operações de escrita idempotentes usam *upsert* compatível com ambos os bancos
(`INSERT ... ON CONFLICT ... DO UPDATE`), evitando ramificações condicionais na lógica.

## 3. Modelo de dados

O esquema relacional é minimalista, com três entidades e integridade referencial:

- **usuarios** — identidade e estado da conta (`locked_until`, `admin`, `primeiro_acesso`);
- **planos** — a trilha de um usuário (categoria, duração, `data_inicio`, pontuação);
- **registros_diarios** — o registro de cada dia (`cumprida`/`falha`), com restrição de
  unicidade `(plano_id, dia_numero)` que garante um único registro por dia.

A ausência de um ORM é uma decisão deliberada: mantém o executável leve e o SQL
explícito, ao custo de exigir disciplina na camada de acesso.

## 4. Lógica de domínio derivada de dados

Uma característica central do projeto é que **grande parte do estado é derivada**, e não
armazenada redundantemente. O dia corrente da trilha é função apenas da data de início:

```python
def dia_atual_do_plano(plano):
    inicio = date.fromisoformat(plano["data_inicio"])
    return max(1, (date.today() - inicio).days + 1)
```

O mecanismo de **travamento diário** — que impede reabrir o app após a decisão do dia —
é modelado por um instante-limite (meia-noite seguinte) comparado ao relógio:

```python
def esta_travado(usuario):
    limite = datetime.fromisoformat(usuario["locked_until"])
    return datetime.now() < limite
```

De igual modo, as **métricas de engajamento** (ofensiva, melhor sequência, medalhas e
"congeladores" que protegem a sequência) são computadas percorrendo-se o histórico, sem
novas colunas no banco:

```python
def calcular_engajamento(historico):
    streak = melhor = freezes = cumpridas = 0
    for h in sorted(historico, key=lambda x: x["dia_numero"]):
        if h["status"] == "cumprida":
            streak += 1; cumpridas += 1
            if cumpridas % GANHA_A_CADA == 0 and freezes < CAP_CONGELADORES:
                freezes += 1
            melhor = max(melhor, streak)
        else:
            if freezes > 0: freezes -= 1     # congelador protege a ofensiva
            else: streak = 0
    return {"ofensiva": streak, "melhor": melhor,
            "congeladores": freezes, "marcos": [m for m in MARCOS if melhor >= m]}
```

Essa estratégia reduz o risco de inconsistência (não há estado duplicado a sincronizar) e
torna as regras **testáveis como funções puras**.

## 5. Camada de apresentação

A interface é gerada por Jinja2 a partir de um *template* base (`base.html`) estendido
pelas telas. Um conjunto de ícones vetoriais (SVG) é encapsulado em macros
(`_icons.html`), promovendo reúso, e o estilo concentra-se em uma única folha com
variáveis CSS (tema claro, tipografia de sistema — sem dependências externas de fonte,
o que preserva o funcionamento *offline*).

## 6. Segunda frente de execução: versão estática client-side

Para viabilizar hospedagem em plataformas de arquivos estáticos (GitHub Pages), o
domínio foi **reimplementado em JavaScript** (`docs/app.js`), preservando a mesma folha
de estilo. Trata-se de uma *Single-Page Application* com roteamento por *hash*, na qual a
persistência é feita no `localStorage` do navegador — espelhando, no cliente, a mesma
lógica derivada do servidor (ex.: `calcularEngajamento`). A equivalência funcional entre
as duas implementações ilustra o benefício de manter as regras de negócio isoladas e
explícitas.

## 7. Distribuição

O mesmo código serve a três alvos de execução:

- **Desktop** — janela nativa via `pywebview`, empacotada em executável com PyInstaller;
- **Web servidor** — `gunicorn` + Flask (Render), com Postgres (Supabase) para persistência;
- **Web estático** — SPA em `localStorage`, sem servidor (GitHub Pages).

## 8. Considerações finais

A organização do ReHabto exemplifica princípios de baixo acoplamento: a separação em
camadas isola a interface do armazenamento; a abstração do SGBD permite trocar SQLite por
PostgreSQL sem alterar o domínio; e a opção por **estado derivado** simplifica as regras
de gamificação. Como consequência, a mesma lógica de hábitos pôde ser reencarnada em
Python (servidor) e em JavaScript (cliente) com paridade de comportamento — evidência
prática de que a modelagem do domínio foi mantida independente da tecnologia de entrega.
