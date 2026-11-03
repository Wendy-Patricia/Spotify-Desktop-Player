# spotify-desktop-player

An Electron application with React and TypeScript

## Spotify: configurar e reproduzir

A interface mantém-se em inglês e a reprodução usa o estado real do Spotify.
Não há reprodução nem progresso simulados.

1. No [Spotify Developer Dashboard](https://developer.spotify.com/dashboard),
   configure uma aplicação com Web API e Web Playback SDK e autorize o utilizador
   nas definições de acesso, se a aplicação estiver em Development Mode.
2. Registe exatamente este Redirect URI: `http://127.0.0.1:43821/callback`.
3. O Client ID e o link da playlist estão diretamente em
   [`src/shared/spotify-config.ts`](src/shared/spotify-config.ts). Estes valores são
   públicos. Nunca coloque Client Secret, passwords ou tokens nesse ficheiro.
4. Execute `npm run dev` e selecione **Connect Spotify** se a sessão ainda não estiver
   autorizada. Conclua o login uma vez no navegador; a sessão é renovada automaticamente.
   A playlist configurada é importada automaticamente após a ligação.
5. O SDK cria e seleciona o dispositivo interno **Pastel Player**. Carregar em Play
   transfere a reprodução para ele. O Spotify Desktop, o Spotify Web Player e o
   Developer Dashboard não precisam de estar abertos. A nossa aplicação precisa de
   permanecer em execução para produzir áudio. Abrir o Spotify Desktop não altera
   automaticamente o dispositivo selecionado. A aplicação não inicia áudio ao abrir.
6. Use Play/Pause, Previous/Next, a barra de progresso, volume/mute, Shuffle e Repeat
   (off → playlist → song). Os comandos são enviados ao Spotify; erros não são
   convertidos em alterações fictícias na interface. Arrastar uma barra envia um
   comando ao libertar o rato ou a tecla, evitando pedidos por cada pixel.

### Requisitos e limitações de execução

**Estado desta instalação:** o áudio inicia, mas a reprodução sustentada é
interrompida com saltos de faixas. A verificação oficial devolveu
`ValidityError: Certificate is valid for development only`. Falta uma assinatura
VMP de produção; ouvir os primeiros segundos não confirma que a licença foi aceite.
O player agora pausa/desliga o SDK na primeira falha e preserva a mensagem original,
em vez de continuar a saltar ou esconder o erro quando o progresso avança.

A ferramenta EVS já está instalada em `.venv`. No terminal, a partir da pasta do
projeto, feche a aplicação e execute:

```bash
npm run drm:signup # crie a conta EVS e confirme o email no terminal
npm run drm:sign   # obtenha a assinatura VMP de produção
npm run drm:verify # confirme que a assinatura é válida
npm start
```

Se já tiver uma conta, use `npm run drm:login` em vez de `drm:signup`. Introduza
password e códigos apenas no terminal da ferramenta oficial, nunca no código nem
no chat. A assinatura deve ser renovada após reinstalar/atualizar o Electron.
Para preparar a ferramenta noutra máquina, crie `.venv` com Python e instale
`scripts/requirements-drm.txt` no respetivo ambiente.

- É necessária uma conta **Spotify Premium** para os endpoints de reprodução e
  para o Web Playback SDK. Aplicações em Development Mode têm ainda restrições
  próprias de utilizadores e acesso; veja o
  [guia de migração da API](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide).
- Este projeto usa **Castlabs Electron for Content Security 44.9.3+wvcus**, em vez
  do Electron normal. `components.whenReady()` instala/atualiza o CDM Widevine antes
  de abrir a janela. O primeiro arranque precisa de internet e pode demorar mais.
  O renderer verifica EME/Widevine antes de inicializar o SDK, mantendo sandbox,
  isolamento de contexto e segurança web ativos.
- Se o SDK falhar, a aplicação mostra o erro local e não seleciona silenciosamente
  outro dispositivo. `Reconnect player` permite tentar novamente.
- Para instalar de raiz use `npm install`; o `postinstall` executa o instalador
  incluído no pacote Castlabs. `electron-builder` usa `node_modules/electron/dist`
  para não substituir acidentalmente o runtime com Widevine pelo Electron normal.
- Algumas políticas de licenciamento e distribuições Windows/macOS exigem assinatura
  VMP de produção. Um instalador distribuído a terceiros deve ser testado e
  assinado separadamente.
  A [documentação Castlabs](https://github.com/castlabs/electron-releases/wiki/EVS)
  descreve o serviço EVS e a criação da conta. Quando necessário:

  ```bash
  python -m pip install --upgrade castlabs-evs
  python -m castlabs_evs.account signup
  python -m castlabs_evs.vmp sign-pkg node_modules/electron/dist
  # Para uma aplicação Windows já empacotada:
  python -m castlabs_evs.vmp sign-pkg dist/win-unpacked
  ```

  A criação/login da conta EVS e a respetiva assinatura não são executados
  automaticamente pelo projeto. A configuração não copia CDMs de outras aplicações.

- As playlists disponíveis dependem da modalidade de acesso da app. As regras
  atuais de Development Mode podem limitar os itens às playlists de que o
  utilizador é proprietário ou colaborador. A importação usa `/items`, aceita o
  campo `item`, e suporta `/tracks`/`track` em integrações antigas. Conteúdo local,
  episódios e faixas indisponíveis não são apresentados como músicas reproduzíveis.
- Controlos restritos pelo Spotify e dispositivos sem suporte de volume ficam
  desativados. O modo aleatório/repetição é aplicado no Spotify, não numa fila local.
- A sessão é renovada automaticamente. O refresh token fica no processo principal,
  cifrado por `safeStorage`; sem proteção do sistema operativo, fica apenas em
  memória. O renderer recebe exclusivamente o access token de curta duração
  necessário ao SDK. **Disconnect** cancela o login e remove a sessão local.

### Sincronização e validação

O SDK fornece eventos `player_state_changed` e estado local a cada segundo. A Web
API confirma o estado global a cada cinco segundos e após comandos. A barra é
interpolada a cada 250 ms a partir da última posição confirmada, sem avançar de
música por um temporizador local. O estado é reconciliado quando a reprodução é
alterada noutra aplicação/dispositivo. Respostas anteriores a logout/reconexão ou
a comandos mais recentes são descartadas. Pedidos 401 renovam o token uma vez e
429 respeitam `Retry-After` sem repetir comandos em ciclo.

`npm test` cobre PKCE/CSRF, armazenamento e renovação de sessão, logout concorrente,
importação/paginação, validação de argumentos IPC, controlo de dispositivos, SDK,
comandos e sincronização com uma API e SDK de teste, incluindo a prioridade do
dispositivo local sobre o Spotify Desktop. Estes testes são separados da validação
real efetuada nesta instalação: playlist importada, dispositivo **Pastel Player**
registado e áudio inicial confirmado. A estabilidade após os primeiros segundos
continua pendente da assinatura VMP de produção e de nova validação em execução.

Referências: [Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk/reference),
[PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow),
[Player API](https://developer.spotify.com/documentation/web-api/reference/get-information-about-the-users-current-playback).

## Comunicação e segurança

O React usa exclusivamente a API tipada `window.api`, exposta pelo preload através
de `contextBridge`. Não tem acesso a Node.js, `ipcRenderer` ou canais arbitrários.

```ts
const response = await window.api.ping() // 'pong'
const versions = await window.api.getVersions()
```

O processo principal valida a janela, o frame principal e o URL do documento em
cada chamada IPC. As operações Spotify validam os argumentos no main antes de
aceder à rede. Para adicionar uma
operação, declare o contrato em `src/shared/api.ts`, exponha um método específico
no preload e registe um handler no main com a mesma validação de origem e
validação dos argumentos recebidos.

As janelas usam `sandbox`, `contextIsolation` e `webSecurity`, com integração de
Node.js, conteúdo inseguro, webviews e funcionalidades experimentais desativados.
As DevTools só estão disponíveis em desenvolvimento. Pedidos e verificações de
permissões são recusados por defeito, com exceção de `mediaKeySystem` para o
documento da aplicação e o iframe oficial do SDK, na janela da aplicação.

A navegação fica limitada ao documento da aplicação. Novas janelas são bloqueadas;
apenas links HTTPS autorizados abrem no navegador do sistema. Os métodos Spotify
constroem URLs de autorização e de faixas/playlists validados no main. Em produção,
a interface usa o protocolo local seguro `pastel://player`, com acesso aos assets
limitado à pasta do renderer.

A CSP permite o script/iframe de `sdk.scdn.co`, capas de `*.scdn.co` e ligações
HTTPS/WSS aos serviços Spotify necessários ao SDK. Objetos, formulários e alterações
ao URL base permanecem bloqueados. `style-src 'unsafe-inline'` mantém a compatibilidade
com estilos dinâmicos e Vite; `'self'` permite a ligação local de HMR. Nenhum handler
IPC genérico ou acesso arbitrário a URLs é exposto ao React.

```bash
npm test # testa as regras de segurança e a API do preload
npm run lint
npm run build # inclui a verificação TypeScript de main, preload e React
```

Referência: [recomendações de segurança do Electron](https://www.electronjs.org/docs/latest/tutorial/security).

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ npm install
```

### Development

```bash
$ npm run dev
```

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```
