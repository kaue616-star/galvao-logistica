# Galvao Logistica — Controle de Comprovantes

Primeira versão do sistema web:
- Login individual para motoboys e administrador.
- Motoboy envia protocolo + foto pelo celular.
- Foto é convertida para JPEG no navegador.
- Data/hora do envio é registrada pelo banco de dados.
- Painel administrativo lista comprovantes, filtra por data/protocolo e mostra pendentes/baixados.
- Download do JPEG marca automaticamente como baixado; administrador pode reabrir como pendente.
- Fotos ficam em bucket privado, acessíveis apenas por sessão autorizada.

## 1. Criar o projeto Supabase
1. Crie um projeto em https://supabase.com/.
2. Em Project Settings > API, copie Project URL e a chave `anon`/publishable.
3. No SQL Editor, execute todo o arquivo `supabase/schema.sql`.
4. Em Authentication > Providers, mantenha Email habilitado. Desative cadastro público (Signups) se disponível; os usuários devem ser criados pelo administrador.
5. Em Authentication > Users, crie o usuário administrador e os usuários dos motoboys com e-mail e senha.
6. Copie o UUID de cada usuário e execute no SQL Editor:
   `insert into public.profiles (id, full_name, role) values ('UUID', 'Nome', 'admin');`
   Use `driver` para cada motoboy e `admin` somente para o administrador.
7. Não compartilhe a chave `service_role`. O site usa apenas a chave pública anon/publishable.

## 2. Rodar no computador
Instale Node.js LTS. Na pasta do projeto:
```bash
npm install
cp .env.example .env
```
Edite `.env` com:
```env
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=SUA_CHAVE_PUBLICA_ANON
```
Depois:
```bash
npm run dev
```
Abra o endereço local mostrado no terminal.

## 3. Publicar
Faça upload desta pasta para um repositório privado no GitHub e importe o repositório na Vercel.
Configure as mesmas variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` nas configurações do projeto Vercel e publique.
O endereço provisório será fornecido pela Vercel. Depois pode conectar um domínio próprio.

## Observações importantes
- O sistema registra a data/hora do envio no banco em UTC; a tela exibe no fuso de São Paulo.
- O filtro por data usa o dia local de São Paulo.
- A marcação como baixado ocorre depois que o navegador inicia o download; não é possível garantir que o usuário abriu o arquivo.
- A primeira versão não tem recuperação de senha nem cadastro de usuários dentro da interface. Criação de contas é feita pelo painel do Supabase.
- Faça testes com comprovantes fictícios antes de usar com documentos reais.
- Proteja o acesso administrativo e não compartilhe credenciais. A foto do comprovante pode conter dados pessoais; limite o acesso a pessoas autorizadas.
