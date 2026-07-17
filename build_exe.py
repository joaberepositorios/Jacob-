"""
Gera o ReHabto.exe usando PyInstaller.
Rode este script no Windows, dentro da pasta do projeto, com o venv ativado:

    python build_exe.py

O executável final aparece em dist/ReHabto/ReHabto.exe
"""
import PyInstaller.__main__
import os

BASE = os.path.dirname(os.path.abspath(__file__))

PyInstaller.__main__.run([
    "executar.py",
    "--name=ReHabto",
    "--onedir",              # onedir inicia mais rápido que --onefile; troque se preferir um único arquivo
    "--windowed",             # sem console aparecendo atrás da janela
    "--add-data=templates;templates",
    "--add-data=static;static",
    "--clean",
    "--noconfirm",
])
