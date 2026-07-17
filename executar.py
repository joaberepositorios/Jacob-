"""
Ponto de entrada do executável (.exe).
Sobe o Flask numa thread em background e abre uma janela nativa (pywebview)
apontando pra ele — pra quem usa o app, parece um programa desktop comum,
sem navegador, sem barra de endereço.
"""
import threading
import webview

from app import app

HOST = "127.0.0.1"
PORT = 5123


def rodar_flask():
    app.run(host=HOST, port=PORT, debug=False, use_reloader=False)


if __name__ == "__main__":
    thread_flask = threading.Thread(target=rodar_flask, daemon=True)
    thread_flask.start()

    webview.create_window(
        "HabiTrilha",
        f"http://{HOST}:{PORT}",
        width=1180,
        height=760,
        min_size=(900, 600),
    )
    webview.start()
