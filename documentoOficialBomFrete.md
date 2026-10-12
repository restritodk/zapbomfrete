# Documento Oficial — Bom Frete / ZapBomFrete

**Nome interno do pacote:** `wa-akg` (base tecnológica WA-AKG)  
**Produto / branding:** Bom Frete Transportes + plataforma ZapPro  
**Repositório:** https://github.com/restritodk/zapbomfrete  
**Versão do app (package.json):** 1.6.4  
**Público deste documento:** desenvolvedores que forem manter, implantar ou evoluir o sistema  

Este documento descreve a arquitetura, o banco de dados, as funcionalidades, as rotas, a autenticação e o fluxo operacional do projeto, para que outro desenvolvedor consiga se orientar sem se perder.

---

## 1. O que é o projeto

Sistema **self-hosted** de **Gateway WhatsApp** com:

- Dashboard web (painel administrativo)
- Múltiplas sessões WhatsApp (QR Code / Baileys)
- Chat em tempo real
- Disparo em massa (broadcast)
- Automação (bot, auto-reply, agendador)
- Webhooks e API REST com API Key
- Gestão de contatos, grupos, etiquetas e mídia
- Branding customizável (nome, logo, favicon)

O código-base original é o **WA-AKG**. Esta instalação foi personalizada para a **Bom Frete**, com tela de login própria, logos ZapPro/Bom Frete e ajustes de UX/PT-BR.

---

## 2. Stack tecnológica

| Camada | Tecnologia |
|--------|------------|
| Framework web | **Next.js 16** (App Router) |
| UI | **React 19**, Tailwind CSS 4, componentes estilo shadcn/Radix |
| Linguagem | **TypeScript** |
| Auth | **NextAuth v5** (Credentials + JWT) |
| ORM / Banco | **Prisma 5** + **PostgreSQL** |
| WhatsApp | **@whiskeysockets/baileys** |
| Tempo real | **Socket.IO** (servidor + cliente) |
| Validação | Zod + React Hook Form |
| Imagens / stickers | Sharp, Jimp, wa-sticker-formatter |
| Process manager (produção sugerido) | PM2 |
| Runtime de servidor | Node.js **20+** (recomendado 22+) |

### Entrypoint importante

O projeto **não** usa apenas `next dev`. O servidor principal é customizado:

- Arquivo: `src/server/index.ts`
- Scripts:
  - `npm run dev` → `npx tsx src/server/index.ts`
  - `npm run start` → produção com o mesmo entrypoint
- Esse servidor sobe: Next.js + HTTP + Socket.IO + carregamento das sessões WhatsApp + scheduler.

---

## 3. Estrutura de pastas (mapa rápido)

```
zapbomfrete/
├── prisma/
│   └── schema.prisma          # Schema do banco (PostgreSQL)
├── public/
│   ├── media/                 # Logos e imagem da login (assets de branding)
│   └── branding/              # Uploads de branding ( favicon/logo )
├── scripts/                   # Utilitários (admin, backfill, testes)
├── docs/                      # Documentação técnica legada do WA-AKG
├── src/
│   ├── app/                   # App Router (páginas + API routes)
│   │   ├── auth/              # Login / registro
│   │   ├── dashboard/         # Painel completo
│   │   └── api/               # Endpoints REST
│   ├── components/
│   │   ├── auth/              # Tela de login (login-screen.tsx)
│   │   ├── chat/              # Interface de chat + Socket
│   │   ├── dashboard/         # Sidebar, navbar, sessão, etc.
│   │   └── ui/                # Componentes base
│   ├── lib/                   # auth, prisma, api-auth, webhooks, utils
│   ├── modules/whatsapp/      # Motor Baileys (núcleo do produto)
│   ├── server/                # Servidor HTTP + Socket.IO
│   ├── auth.config.ts         # Config NextAuth (páginas/callbacks)
│   └── proxy.ts               # Regras extras de proteção de rotas
├── middleware.ts              # NextAuth middleware (protege /dashboard)
├── .env.example               # Modelo de variáveis de ambiente
└── documentoOficialBomFrete.md  # Este documento
```

---

## 4. Banco de dados

### 4.1 Qual banco está em uso

**PostgreSQL.**

Confirmado em `prisma/schema.prisma`:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

> Observação: o `.env.example` e o Docker ainda mencionam MySQL em trechos legados. **Neste projeto a fonte da verdade é o Prisma: PostgreSQL.**  
> Exemplo local usado no template: banco `wa_akg` (ou equivalente configurado no seu `.env`).

### 4.2 Como aplicar o schema

```bash
npm run db:push
# equivale a: prisma db push && prisma generate
```

Não há pasta de migrations versionada obrigatória no fluxo atual; o time usa `db push` para sincronizar.

Ferramenta visual:

```bash
npm run db:studio
```

### 4.3 Modelos principais

| Modelo | Função |
|--------|--------|
| `User` | Usuários do sistema (email, senha hash, role, apiKey) |
| `Session` | Sessão WhatsApp (nome, sessionId Baileys, status, QR) |
| `AuthState` | Credenciais Baileys persistidas no banco (multi-device auth) |
| `Chat` | Conversas/inbox espelhadas do WhatsApp |
| `Contact` | Contatos (JID, LID, nome, foto, etc.) |
| `Message` | Mensagens (texto/mídia, status, quote) |
| `Group` | Grupos e metadados |
| `AutoReply` | Respostas automáticas por palavra-chave |
| `BotConfig` | Configuração do bot da sessão |
| `ScheduledMessage` | Mensagens agendadas / recorrentes |
| `Webhook` / `WebhookLog` | Webhooks externos e logs de entrega |
| `Label` / `ChatLabel` | Etiquetas de conversas |
| `SessionAccess` | Compartilhamento de sessão entre usuários |
| `BroadcastLog` / `BroadcastRecipient` | Histórico de disparos em massa |
| `Notification` | Notificações internas do painel |
| `SystemConfig` | Config global (nome app, logo, favicon, registro) |
| `Story` | Stories (status) |

### 4.4 Enums de papel (roles)

```text
SUPERADMIN > OWNER > STAFF
```

- `SUPERADMIN`: acesso total (usuários, monitor, notificações)
- `OWNER`: dono de sessões / operação normal
- `STAFF`: acesso limitado (conforme regras de `SessionAccess` / APIs)

### 4.5 Status típicos de sessão WhatsApp

- `CONNECTED`
- `DISCONNECTED`
- `ZOMBIE` (sessão problemática / órfã)

---

## 5. Autenticação e autorização

### 5.1 Login web

- Tela: `src/components/auth/login-screen.tsx`
- Rota: `/auth/login`
- Provider: **Credentials** (e-mail + senha)
- Senha: bcrypt
- Sessão: **JWT** (NextAuth)

Fluxo após login bem-sucedido: redirecionamento full-page para `/dashboard` (ou `callbackUrl`).

### 5.2 Proteção de rotas

1. **`middleware.ts`** — NextAuth protege páginas do dashboard.
2. **`src/auth.config.ts`** — se não logado em `/dashboard` → login; se logado em `/auth/login` → dashboard.
3. **`src/proxy.ts`** — regras adicionais (APIs, assets, redirects). Em runtime o Next pode reportar tempo em `proxy.ts`.

### 5.3 Autenticação de API

Arquivo: `src/lib/api-auth.ts`

Dois métodos:

1. **Sessão NextAuth** (cookie JWT do browser)
2. **API Key** no header: `x-api-key: <chave do usuário>`

Funções importantes:

- `getAuthenticatedUser(request)`
- `canAccessSession(user, sessionId)`
- `hasRole(userRole, requiredRole)`

### 5.4 Registro

- Rota `/auth/register` (pode ser desabilitada via `SystemConfig.enableRegistration`)
- API: `/api/auth/register`

### 5.5 Criar Super Admin

```bash
npm run make-admin -- admin@empresa.com senhaForte
```

Script: `scripts/setup-admin.js`

---

## 6. Motor WhatsApp (Baileys)

Pasta: `src/modules/whatsapp/`

| Arquivo | Responsabilidade |
|---------|------------------|
| `manager.ts` | Gerencia todas as instâncias em memória (`waManager`) |
| `instance.ts` | Uma conexão Baileys (QR, connect, reconnect, send) |
| `auth/usePrismaAuthState.ts` | Persiste auth Baileys na tabela `AuthState` |
| `store/index.ts` | Bind de eventos (mensagens, sync, webhooks, bot) |
| `store/chats.ts` | Sincroniza chats → tabela `Chat` |
| `store/contacts.ts` | Sincroniza contatos |
| `store/groups.ts` | Sincroniza grupos |
| `store/autoreply.ts` | Motor de auto-reply |
| `chat.service.ts` | Serviços de chat/envio |
| `scheduler.ts` | Envio de mensagens agendadas |
| `antispam.ts` | Controle de taxa de envio |
| `bot/command-handler.ts` | Comandos do bot |

### Bootstrap

Ao subir o servidor (`src/server/index.ts`):

1. Prepara Next.js
2. Cria HTTP server + Socket.IO (`path: /api/socket/io`)
3. `waManager.setup(io)`
4. `waManager.loadSessions()` — reconecta sessões salvas
5. Inicia scheduler

---

## 7. Tempo real (Socket.IO)

| Lado | Arquivo |
|------|---------|
| Servidor | `src/server/socket.ts` |
| Cliente | `src/components/chat/socket-context.tsx` |

Path do socket: **`/api/socket/io`**

Salas típicas:

- Sessão WhatsApp: join por `sessionId`
- Usuário: `user:{userId}`

Eventos comuns emitidos pelo backend:

- `connection.update`
- `message.upsert`
- `message.update`
- `chats.synced`
- `broadcast.progress`
- `notification:new`

---

## 8. Funcionalidades do Dashboard

Base URL do painel: `/dashboard`

| Rota | Função |
|------|--------|
| `/dashboard` | Painel / visão geral |
| `/dashboard/sessions` | Criar/gerenciar sessões + QR |
| `/dashboard/sessions/[sessionId]` | Detalhe da sessão |
| `/dashboard/sessions/access` | Compartilhar acesso a sessões |
| `/dashboard/chat` | Chat WhatsApp (lista + conversa) |
| `/dashboard/broadcast` | Disparo em massa |
| `/dashboard/sticker` | Criador de figurinhas |
| `/dashboard/contacts` | Contatos |
| `/dashboard/groups` | Grupos |
| `/dashboard/labels` | Etiquetas |
| `/dashboard/bot-settings` | Configurações do bot |
| `/dashboard/autoreply` | Respostas automáticas |
| `/dashboard/profile` | Perfil do bot |
| `/dashboard/scheduler` | Agendamento de mensagens |
| `/dashboard/webhooks` | Webhooks + logs |
| `/dashboard/media` | Gerenciador de mídia |
| `/dashboard/settings` | Configurações / branding |
| `/dashboard/users` | Usuários (**SUPERADMIN**) |
| `/dashboard/system-monitor` | Monitor do sistema (**SUPERADMIN**) |
| `/dashboard/notifications` | Notificações (**SUPERADMIN**) |
| `/dashboard/api-docs` | Documentação da API no painel |

Documentação Swagger adicional (se habilitada): `/docs` e `/swagger`.

---

## 9. API REST (visão geral)

Raiz: `/api/...`

Grupos principais em `src/app/api/`:

| Grupo | Uso |
|-------|-----|
| `auth` | NextAuth + registro |
| `sessions` | CRUD sessões, QR, bot-config, access |
| `messages` | Enviar texto/mídia, broadcast, react, forward |
| `chat` / `chats` | Lista chats, mute, archive, pin, read |
| `contacts` | Contatos |
| `groups` | Grupos |
| `labels` | Etiquetas |
| `autoreplies` | Auto-replies |
| `scheduler` | Agendamentos |
| `webhooks` | Webhooks e logs |
| `media` | Upload/gestão de mídia |
| `settings` | Config do sistema / branding upload |
| `users` | Gestão de usuários |
| `user` | Perfil / API key do usuário |
| `notifications` | Notificações |
| `system` | Monitor e updates |
| `profile` | Perfil WhatsApp da sessão |

### Autenticação nas APIs

- Browser: cookie de sessão NextAuth
- Integrações externas: header `x-api-key`

Documentação mais detalhada (legado WA-AKG):

- `docs/API_DOCUMENTATION.md`
- `docs/API-QUICK-REFERENCE.md`

---

## 10. Branding e tela de login (custom Bom Frete)

### Login

Arquivo: `src/components/auth/login-screen.tsx`

- Painel esquerdo azul com curva Bézier + foto do caminhão
- Logo ZapPro no topo esquerdo: `/media/logo-principal.png`
- Card branco com logo Bom Frete: `/media/logo-transparent.png`
- Foto de fundo: `/media/imagem-login.jpg`

### Assets públicos relevantes

| Arquivo | Uso |
|---------|-----|
| `public/media/logo-principal.png` | Logo ZapPro (login) |
| `public/media/logo-transparent.png` | Logo Bom Frete no card |
| `public/media/logo-white.png` | Logo Bom Frete para fundo escuro |
| `public/media/logo.png` | Logo Bom Frete colorida |
| `public/media/imagem-login.jpg` | Fotografia do painel de login |

Configuração dinâmica (banco `SystemConfig`):

- `appName`, `logoUrl`, `faviconUrl`, `enableRegistration`, `timezone`

Upload de branding via API/settings (dashboard Configurações).

---

## 11. Variáveis de ambiente (obrigatórias e importantes)

Modelo: `.env.example` → copiar para `.env`

### Obrigatórias para subir

| Variável | Descrição |
|----------|-----------|
| `DATABASE_URL` | Connection string PostgreSQL |
| `AUTH_SECRET` | Segredo NextAuth (gerar com `openssl rand -base64 32`) |
| `PORT` | Porta HTTP (ex.: `3000`) |
| `BASE_URL` | URL pública (ex.: `http://localhost:3000`) |
| `NODE_ENV` | `development` / `production` |

### Importantes

| Variável | Descrição |
|----------|-----------|
| `NEXTAUTH_URL` | Deve bater com `BASE_URL` |
| `AUTH_TRUST_HOST` | `true` atrás de proxy/Nginx/Cloudflare |
| `APP_NAME` | Nome exibido |
| `TZ` | Ex.: `America/Sao_Paulo` |
| `LOCALE` | Ex.: `pt-BR` |
| `BAILEYS_LOG_LEVEL` | `error` em produção |
| `MEDIA_STORAGE_PATH` | Pasta de uploads (default `uploads`) |
| `NEXT_PUBLIC_SWAGGER_ENABLED` | Liga/desliga Swagger |
| `ENABLE_RATE_LIMITING` | Rate limit de API |

**Nunca commitar o arquivo `.env`.** Ele está no `.gitignore`.

---

## 12. Como rodar o projeto (dev)

### Pré-requisitos

- Node.js 20+ (22 recomendado)
- PostgreSQL rodando
- Git
- (Opcional produção) PM2

### Passo a passo

```bash
# 1. Clonar
git clone https://github.com/restritodk/zapbomfrete.git
cd zapbomfrete

# 2. Instalar dependências
npm install

# 3. Ambiente
cp .env.example .env
# Editar DATABASE_URL, AUTH_SECRET, PORT, BASE_URL, TZ, LOCALE

# 4. Banco
npm run db:push

# 5. Criar admin
npm run make-admin -- seu@email.com suaSenha

# 6. Subir
npm run dev
```

Abrir: `http://localhost:3000/auth/login` (ou a porta do `.env`).

### Produção (resumo)

```bash
npm run build
npm run start
# ou via PM2 apontando para o script start
```

---

## 13. Fluxos que o dev precisa entender

### 13.1 Conectar WhatsApp

1. Login no dashboard  
2. Ir em **Sessões / QR**  
3. Criar sessão → escanear QR no celular  
4. Status vai para `CONNECTED`  
5. Contatos/chats/grupos começam a sincronizar para o PostgreSQL  

### 13.2 Enviar mensagem (UI)

Dashboard Chat → seleciona conversa → envia → Baileys envia → evento Socket atualiza UI → registro em `Message`.

### 13.3 Enviar mensagem (API)

1. Obter API Key do usuário (perfil / users)  
2. `POST /api/messages/...` com header `x-api-key`  
3. Sessão precisa estar `CONNECTED` e acessível ao usuário  

### 13.4 Webhook

1. Cadastrar URL + eventos em `/dashboard/webhooks`  
2. Sistema dispara HTTP POST quando eventos ocorrem  
3. Logs ficam em `WebhookLog`  

---

## 14. Scripts úteis

| Script | Função |
|--------|--------|
| `npm run make-admin` | Cria/atualiza Super Admin |
| `npm run db:push` | Sincroniza schema Prisma |
| `npm run db:studio` | UI do banco |
| `scripts/backfill-chats.ts` | Backfill de chats |
| `scripts/enrich-chat-names.ts` | Enriquece nomes de chats |
| `scripts/cleanup-ghost-chats.sql` | Limpeza SQL de chats fantasma |

> Evitar versionar/commitar scripts com dados pessoais de produção (ex.: JIDs reais de clientes).

---

## 15. Convenções e cuidados

1. **Banco = PostgreSQL** (não misturar provider MySQL no `schema.prisma` sem migração completa).  
2. **Sessões WhatsApp são o núcleo**: quase tudo depende de `sessionId`.  
3. **AuthState no banco**: não apagar `AuthState` sem querer desconectar o WhatsApp.  
4. **Socket path** é `/api/socket/io` (não o default `/socket.io`).  
5. **Branding de login** usa arquivos em `public/media/` (há exceções no `.gitignore` para as logos oficiais).  
6. **Roles**: features de administração só para `SUPERADMIN`.  
7. Em desenvolvimento, Turbopack/HMR pode falhar; limpar `.next` e reiniciar costuma resolver loops estranhos.  
8. O `package.json` ainda se chama `wa-akg` — isso é herdado; o produto entregue é Bom Frete/ZapBomFrete.

---

## 16. Documentação complementar (já existente)

| Arquivo | Conteúdo |
|---------|----------|
| `docs/PROJECT_DOCUMENTATION.md` | Arquitetura legada Micro Hard Center |
| `docs/DATABASE_SETUP.md` | Setup de banco |
| `docs/ENVIRONMENT_VARIABLES.md` | Variáveis detalhadas |
| `docs/API_DOCUMENTATION.md` | API completa |
| `docs/USER_GUIDE.md` | Guia de uso |
| `README.md` | Instalação rápida |

Este arquivo (`documentoOficialBomFrete.md`) é a **visão oficial de handoff** da instalação Bom Frete.

---

## 17. Checklist para um novo desenvolvedor no 1º dia

- [ ] Clonar `https://github.com/restritodk/zapbomfrete.git`
- [ ] Instalar Node 20+/22 e PostgreSQL
- [ ] Copiar `.env.example` → `.env` e preencher `DATABASE_URL` + `AUTH_SECRET`
- [ ] Rodar `npm install` e `npm run db:push`
- [ ] Criar admin com `npm run make-admin`
- [ ] Subir com `npm run dev`
- [ ] Entrar em `/auth/login` e validar logos ZapPro / Bom Frete
- [ ] Criar uma sessão WhatsApp de teste e escanear QR
- [ ] Validar chat + Socket (mensagem chega em tempo real)
- [ ] Ler `src/modules/whatsapp/manager.ts` e `instance.ts` (coração do sistema)
- [ ] Ler `prisma/schema.prisma` inteiro pelo menos uma vez

---

## 18. Contato / repositório

- **GitHub:** https://github.com/restritodk/zapbomfrete  
- **Branch principal:** `main`

---

*Documento gerado para entrega técnica do projeto Bom Frete (ZapBomFrete). Atualize este arquivo sempre que houver mudança estrutural relevante (banco, auth, Baileys ou deploy).*
