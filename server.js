const WebSocket = require('ws');
const os = require('os');
const PORTA = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORTA });

let jogadores = [];
const paletaCores = ["#00FFFF", "#FF5555", "#55FF55", "#FFFF55", "#FF55FF", "#FFA500", "#87CEFA", "#98FB98"];
let proximoIndiceCor = 0;
let estadoJogo = "ESPERA"; // "ESPERA", "CHOOSE", "JOGO", "TERMINO"
let timerAtual = 0;

let pongAssento1 = null;
let pongAssento2 = null;

function enviarCoresOcupadas() {
    const ocupadas = jogadores.map(j => j.corLobbyIndex);
    const listaJogadoresCores = jogadores.map(j => ({
        id: String(j.id),
        cor: j.corLobbyIndex
    }));
    broadcast({
        tipo: "CORES_LOBBY_SYNC",
        ocupadas: ocupadas,
        lista: listaJogadoresCores
    });
}


function enviarEstadoPong() {
    broadcast({
        tipo: "PONG_ESTADO_SYNC",
        a1: pongAssento1 !== null,
        a2: pongAssento2 !== null,
        ativa: (pongAssento1 !== null && pongAssento2 !== null)
    });
}

function obterIPWiFi() {
    const interfaces = os.networkInterfaces();
    for (let nome in interfaces) {
        for (let info of interfaces[nome]) {
            if (info.family === 'IPv4' && !info.internal) return info.address;
        }
    }
    return "127.0.0.1";
}

console.log("=================================================");
console.log("Servidor Multi-Jogadores ONLINE na porta " + PORTA + "!");
console.log("IP PC:      127.0.0.1");
console.log("IP Celular: " + obterIPWiFi());
console.log("=================================================");

// Loop do Relógio Oficial do Servidor (1 segundo)
setInterval(() => {
    if (estadoJogo === "ESPERA") {
        if (jogadores.length >= 2) {
            if (timerAtual <= 0) timerAtual = 40;
            timerAtual--;
            if (timerAtual <= 0) {
                pongAssento1 = null;
                pongAssento2 = null;
                iniciarSelecaoESorteio();
            }
        } else {
            timerAtual = 0;
            broadcast({ tipo: "TIMER", valor: 0, estado: "ESPERA", total: jogadores.length });
        }
    } else if (estadoJogo === "JOGO") {
        if (timerAtual > 0) {
            timerAtual--;
            broadcast({ tipo: "TIMER", valor: timerAtual, estado: "JOGO", total: jogadores.length });

            if (timerAtual <= 0) {
                encerrarPartida("sobreviventes");
            }
        }
    }
}, 1000);

function encerrarPartida(vencedorTime) {
    if (estadoJogo !== "JOGO") return;
    estadoJogo = "TERMINO";
    timerAtual = 0;

    const listaSobreviventes = jogadores
        .filter(j => j.papel === "sobrevivente")
        .map(j => ({
            nome: j.nomeClasse,
            personagemID: j.personagemID,
            vivo: j.vivo
        }));

    const killerObj = jogadores.find(j => j.papel === "killer");
    const killerID = killerObj ? killerObj.personagemID : 0;

    console.log("Partida encerrada! Vencedor: " + vencedorTime);

    broadcast({
        tipo: "FIM_PARTIDA",
        vencedor: vencedorTime,
        sobreviventes: listaSobreviventes,
        killerID: killerID
    });
	setTimeout(() => {
    		voltarParaLobbyComTimer(75);
	}, 8000);

}

function voltarParaLobbyComTimer(segundos) {
    pongAssento1 = null;
    pongAssento2 = null;

    if (jogadores.length < 2) {
        estadoJogo = "ESPERA";
        timerAtual = 0;
        broadcast({ tipo: "VOLTAR_ESPERA" });
        return;
    }

    estadoJogo = "ESPERA";
    timerAtual = segundos; // 75 segundos = 1:15!
    broadcast({ tipo: "VOLTAR_ESPERA" });
    broadcast({ tipo: "TIMER", valor: timerAtual, estado: "ESPERA", total: jogadores.length });
    console.log("Todos voltaram ao Lobby! Proxima partida em " + segundos + "s.");
}


function iniciarSelecaoESorteio() {
    if (jogadores.length < 2) {
        estadoJogo = "ESPERA";
        timerAtual = 0;
        broadcast({ tipo: "VOLTAR_ESPERA" });
        return;
    }

    estadoJogo = "CHOOSE";
    timerAtual = 0;
    const indiceKiller = Math.floor(Math.random() * jogadores.length);

    jogadores.forEach((j, index) => {
        j.pronto = false;
        j.vivo = true;
        j.personagemID = -1;
        j.papel = (index === indiceKiller) ? "killer" : "sobrevivente";
        j.ws.send(JSON.stringify({ tipo: "IR_PARA_CHOOSE", papel: j.papel }));
    });

    console.log("Novo sorteio realizado entre " + jogadores.length + " jogadores!");
}

wss.on('connection', (ws) => {
    const jogador = {
        ws: ws,
        corLobbyIndex: -1,
        id: Date.now() + Math.floor(Math.random() * 1000),
        papel: "sobrevivente",
        personagemID: -1,
        nomeClasse: "Jogador",
        corHex: paletaCores[proximoIndiceCor % paletaCores.length],
        pronto: false,
        vivo: true
    };
    proximoIndiceCor++;

    jogadores.push(jogador);
    console.log("Jogador entrou! Total conectados: " + jogadores.length);

    broadcast({ tipo: "TIMER", valor: timerAtual, estado: estadoJogo, total: jogadores.length });
    enviarCoresOcupadas();
    enviarEstadoPong();

    ws.on('message', (mensagem) => {
        try {
            const textoLimpo = mensagem.toString().replace(/\0/g, '').trim();
            if (!textoLimpo) return;
            const dados = JSON.parse(textoLimpo);

            if (dados.tipo === "ESCOLHER_COR_LOBBY") {
                let desejada = Number(dados.corIndex);
                if (desejada < 0 || desejada > 13) desejada = 0;

                const jaUsada = jogadores.some(j => j.ws !== ws && j.corLobbyIndex === desejada);
                if (!jaUsada) {
                    jogador.corLobbyIndex = desejada;
                } else {
                    const livres = [];
                    for (let i = 0; i < 14; i++) {
                        if (!jogadores.some(j => j.ws !== ws && j.corLobbyIndex === i)) livres.push(i);
                    }
                    if (livres.length > 0) {
                        jogador.corLobbyIndex = livres[Math.floor(Math.random() * livres.length)];
                    }
                }

                ws.send(JSON.stringify({ tipo: "MINHA_COR_CONFIRMADA", corIndex: jogador.corLobbyIndex }));
                enviarCoresOcupadas();
                return;
            }

            if (dados.tipo === "PONG_PEDIR_ASSENTO") {
                if (pongAssento1 === null) {
                    pongAssento1 = jogador.id;
                    ws.send(JSON.stringify({ tipo: "PONG_ASSENTO_CONFIRMADO", assento: 1 }));
                } else if (pongAssento2 === null && pongAssento1 !== jogador.id) {
                    pongAssento2 = jogador.id;
                    ws.send(JSON.stringify({ tipo: "PONG_ASSENTO_CONFIRMADO", assento: 2 }));
                }
                enviarEstadoPong();
                return;
            }

            if (dados.tipo === "PONG_SAIR" || dados.tipo === "PONG_ENCERRAR") {
                if (dados.tipo === "PONG_ENCERRAR") {
                    pongAssento1 = null;
                    pongAssento2 = null;
                } else {
                    if (pongAssento1 === jogador.id) pongAssento1 = null;
                    if (pongAssento2 === jogador.id) pongAssento2 = null;
                }
                enviarEstadoPong();
                return;
            }

            if (dados.tipo === "CHAT_MENSAGEM") {
                const textoMsg = String(dados.texto || "").trim().slice(0, 80);
                if (!textoMsg) return;

                const mesmos = jogadores.filter(j => j.nomeClasse === jogador.nomeClasse);
                let nomeExibido = jogador.nomeClasse;
                if (mesmos.length > 1) {
                    nomeExibido = jogador.nomeClasse + (mesmos.indexOf(jogador) + 1);
                }

                broadcast({ tipo: "CHAT_RECEBER", nome: nomeExibido, cor: jogador.corHex, texto: textoMsg });
                return;
            }

            if (dados.tipo === "ESCOLHEU_PERSONAGEM") {
                jogador.nomeClasse = dados.nomeClasse || "Jogador";
                jogador.personagemID = dados.personagemID;
                jogador.pronto = true;

                if (jogadores.every(j => j.pronto) && jogadores.length >= 2) {
                    estadoJogo = "JOGO";
                    const qtdSobreviventes = jogadores.filter(j => j.papel === "sobrevivente").length;
                    timerAtual = (qtdSobreviventes === 1) ? 75 : 240;

                    jogadores.forEach(j => {
                        const outro = jogadores.find(o => o.id !== j.id) || j;
                        const listaOutros = jogadores
                            .filter(o => o.id !== j.id)
                            .map(o => ({ id: o.id, papel: o.papel, personagemID: o.personagemID }));

                        j.ws.send(JSON.stringify({
                            tipo: "INICIAR_JOGO",
                            meuPersonagem: j.personagemID,
                            inimigoPapel: outro.papel,
                            inimigoPersonagem: outro.personagemID,
                            outrosJogadores: listaOutros,
                            timerInicial: timerAtual
                        }));
                    });
                }
                return;
            }

            if (dados.tipo === "MORREU") {
                jogador.vivo = false;
                console.log("Um jogador foi eliminado!");

                const sobreviventesVivos = jogadores.filter(j => j.papel === "sobrevivente" && j.vivo);
                if (sobreviventesVivos.length === 0 && estadoJogo === "JOGO") {
                    encerrarPartida("killer");
                }
                return;
            }

            if (dados.tipo === "SOBREVIVENTE_ESCAPOU") {
                if (estadoJogo === "JOGO") {
                    encerrarPartida("sobreviventes");
                }
                return;
            }

            // Anexa quem enviou o pacote para que 3+ jogadores saibam qual boneco mover!
            dados.remetenteID = jogador.id;
            jogadores.forEach(outro => {
                if (outro.ws !== ws && outro.ws.readyState === WebSocket.OPEN) {
                    outro.ws.send(JSON.stringify(dados));
                }
            });
        } catch (erro) {}
    });

    ws.on('close', () => {
        if (pongAssento1 === jogador.id) pongAssento1 = null;
        if (pongAssento2 === jogador.id) pongAssento2 = null;
        jogadores = jogadores.filter(j => j.ws !== ws);
        console.log("Jogador saiu. Total restantes: " + jogadores.length);
        enviarCoresOcupadas();
        enviarEstadoPong();

        if (jogadores.length < 2 && estadoJogo !== "ESPERA") {
            estadoJogo = "ESPERA";
            timerAtual = 0;
            broadcast({ tipo: "VOLTAR_ESPERA" });
        }
    });
});

function broadcast(obj) {
    const texto = JSON.stringify(obj);
    jogadores.forEach(j => {
        if (j.ws.readyState === WebSocket.OPEN) j.ws.send(texto);
    });
}

