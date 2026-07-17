# HabiTrilha

App desktop de produtividade e formação de hábitos: o usuário se cadastra, monta um
planejamento (categoria, tempo por dia, vezes por dia) e recebe uma trilha de **40 dias
seguidos** para cumprir a mesma missão todo dia. Cada dia só pode ser confirmado
("cumprida") ou desistido ("falha") uma vez — depois disso o app **trava até 00:00**.

## Estrutura do projeto

```
habitrilha/
├── app.py              # rotas Flask (cadastro, login, planejamento, dashboard, ações)
├── database.py         # SQLite puro (usuários, planos, registros diários)
├── executar.py         # ponto de entrada do .exe (abre janela nativa com pywebview)
├── build_exe.py         # script que gera o .exe com PyInstaller
├── requirements.txt
├── templates/           # HTML (Jinja2)
└── static/css/style.css # visual (paleta terrosa + trilha de 40 dias)
```

## Rodando em modo desenvolvimento (sem gerar .exe)

```bash
python -m venv venv
venv\Scripts\activate          # Windows
pip install -r requirements.txt
python app.py
```

Acesse `http://127.0.0.1:5000` no navegador. O banco `habitrilha.db` é criado
automaticamente na primeira execução, na mesma pasta do projeto.

## Rodando como janela nativa (sem PyInstaller ainda)

```bash
pip install pywebview
python executar.py
```

Isso já abre numa janela própria (sem navegador visível), do jeito que o `.exe` final vai se comportar.

## Gerando o .exe (fazer isso dentro do Windows)

O PyInstaller empacota para o sistema operacional em que ele roda — então, para gerar
um `.exe` do Windows, você precisa rodar os comandos abaixo **numa máquina Windows**
(não dá pra gerar `.exe` a partir de Linux/Mac).

```bash
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python build_exe.py
```

O executável final fica em:

```
dist\HabiTrilha\HabiTrilha.exe
```

Copie a pasta `dist\HabiTrilha` inteira para distribuir o app — o `.exe` precisa dos
outros arquivos que ficam ao lado dele nessa pasta (é o modo `--onedir`, que abre mais
rápido que `--onefile`). Se preferir um único arquivo `.exe` grande, troque
`--onedir` por `--onefile` em `build_exe.py`.

## Antes de distribuir para outras pessoas

Troque a linha em `app.py`:

```python
app.secret_key = "troque-esta-chave-antes-de-distribuir"
```

por uma chave aleatória de verdade, por exemplo gerando uma com:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

## Onde ficam os dados

Cada instalação guarda os dados localmente, em `habitrilha.db` (SQLite), na mesma
pasta do executável — não há servidor externo nem sincronização entre computadores.

## Decisões de produto assumidas (ajuste se quiser outro comportamento)

- **Pontuação**: cumprir a missão do dia soma +1 ponto; desistir tira −1 ponto. A
  sequência de 40 dias **não reseta** ao falhar — ela sempre avança 1 dia por dia
  corrido a partir da data de início, conforme pedido.
- **Trava**: ao confirmar cumprida OU desistir, o app inteiro trava até a meia-noite
  seguinte (não dá pra reabrir e ver nem o painel).
- **Dia 41**: ao passar do dia 40, a trilha é marcada como concluída e o usuário pode
  montar uma nova trilha (outra categoria, ou repetir a mesma).
