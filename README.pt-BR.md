# dsh-nextsteps

[English](README.md) · Português (Brasil) · [简体中文](README.zh-CN.md)

[![npm](https://img.shields.io/npm/v/dsh-nextsteps)](https://www.npmjs.com/package/dsh-nextsteps) [![license](https://img.shields.io/github/license/klaus-2/dsh-nextsteps)](LICENSE) [![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-plugin-e5484d)](https://github.com/deepseek-ai/deepseek-harness)

**Cada turno concluído do agente termina com próximos passos prontos para clicar.**

`dsh-nextsteps` é um plugin do [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) que sugere cerca de três prompts de followup ao final de cada turno, renderiza-os como cards clicáveis sob o turno concluído e envia o prompt clicado como sua próxima mensagem — um clique, zero digitação. Em `Automático` o próprio modelo que responde os escreve; com um idioma explícito o plugin os produz numa chamada limpa própria, então os cards ficam nesse idioma mesmo quando a conversa está em outro.

```
dsh plugin --profile web add dsh-nextsteps
```

## Tour do produto

![Demo do Nextsteps](docs/assets/demo.svg)

1. Pergunte qualquer coisa. Em `Automático` o próprio modelo escreve os cards, como último passo antes da resposta final; com um idioma ou modelo explícito, o plugin os gera depois do turno.
2. O turno concluído renderiza seus próprios cards de sugestão — atribuídos àquele turno, nunca repetidos entre mensagens.
3. Clique num card: o prompt é enviado literalmente como sua próxima mensagem na fila e o card muda para o estado de enviado.
4. Cada card tem também uma barra de ações: copiar, favoritar, editar, descartar e expandir. Expandir revela o prompt completo sem enviar nada.
5. Tudo sobrevive a restarts: os cards, a atribuição de turno e os que você já clicou.
6. Abra as configurações do dsh → **Nextsteps** para escolher o idioma de geração (15 idiomas ou Automático), quantas sugestões por turno (1–6), os estilos de sugestão, o modo de geração, o orçamento de latência, o tamanho da sugestão e se o pequeno cabeçalho aparece.

## Funcionalidades

- Atribuição por turno — as sugestões ficam ligadas ao turno que as gerou, através de reloads e restarts do app.
- Envio com um clique pelo próprio controlador de conversa da sessão, com fallback pelo composer.
- Capturas persistentes: cards clicados continuam marcados após restarts (chaves endereçadas por conteúdo, turno retro-preenchido do histórico).
- Rótulos com truncamento automático quando ausentes; validação estrita do payload com feedback corretivo ao modelo.
- **Estilos de sugestão** — uma seleção múltipla entre *Próxima ação*, *Explorar* e *Aprofundar*. O gerador recebe a instrução de variar os prompts entre os ângulos escolhidos; o padrão são os três.
- **Geração sob demanda** — escolha `Sob demanda` e o modelo recebe a instrução de não chamar a tool; um botão **Gerar sugestões** sob a resposta pede os cards. O botão existe nos dois modos, o inline e o do host, e pede ao host exatamente uma vez.
- **Copiar** uma sugestão com um clique, direto para a área de transferência.
- **Favoritos** — guarde as sugestões que quer reutilizar, e copie ou remova-as pela página de configurações.
- **Descartar** uma sugestão que você não quer, e **restaurar** o descarte mais recente; a lista de descartes também vive na página de configurações.
- **Editar** uma sugestão antes de enviá-la: o texto editado é o que é enviado, e o card guardado continua intacto.
- **Expandir** uma sugestão para ler o prompt completo sem enviar nada.
- **Adicionar uma sugestão** à mão sob a resposta, ao lado do cabeçalho.
- **Atalhos de teclado**, locais do card: `c` copia, `f` favorita, `e` edita, `d` descarta e `Esc` fecha o editor ou a expansão. As dicas aparecem quando o card tem o foco; `Enter` e `Space` enviam o card como sempre.
- **Uma região viva** anuncia cada ação para leitores de tela, e o mesmo texto aparece ao lado dos cards — nada é anunciado em silêncio.
- **Métricas de desempenho** nas configurações — a duração média e a pior da geração, da captura e da construção dos cards, com a contagem de amostras; um estágio sem amostras diz isso em vez de mostrar um zero falso.
- **Um orçamento de latência** para o gerador (5 000–120 000 ms) e um tamanho de sugestão limitado (60–600 caracteres), para que um modelo lento não segure um turno para sempre.
- Um histórico de capturas incremental: cada sessão guarda sua própria chave e um índice registra a ordem, então uma sessão que você nunca abre nunca é lida.
- Página de configurações dentro das configurações do dsh — idioma, followups por turno, estilos, modo de geração, orçamento de latência, tamanho da sugestão, visibilidade do cabeçalho, métricas, favoritos, descartes, atualizações.
- Um idioma explícito (ou um modelo explícito) passa a usar uma chamada limpa separada, então os cards mantêm esse idioma mesmo numa conversa escrita em outro; `Automático` sem modelo segue a conversa dentro do turno.
- Atualizador in-app — verificação de versão, instalação com um clique, notas de release, pedido de reinício.
- Interface em English, Português (Brasil) e 简体中文.

## Atalhos de teclado e a região viva

Os atalhos são **locais do card** — funcionam quando o card tem o foco e nunca mudam o que outra parte do chat faz. `c` copia o prompt, `f` alterna o favorito, `e` abre o editor, `d` descarta o card e `Esc` fecha o editor ou recolhe a expansão. Um atalho é ignorado enquanto o editor tem o foco e sempre que uma tecla modificadora está pressionada, então as teclas de edição normais continuam funcionando. A linha de dicas aparece sob o card quando ele está em foco, e cada botão de ação carrega o atributo `aria-keyshortcuts`, para que o atalho também seja anunciado.

Cada ação grava seu resultado em uma região viva — um único elemento com `role="status"` cujo texto muda — e o mesmo texto é exibido ao lado dos cards. É por isso que copiar, favoritar, descartar, editar e restaurar são todos anunciados uma única vez, e por isso uma cópia que falha avisa que falhou em vez de parecer um sucesso.

## Como o idioma é garantido

- `Automático` sem modelo mantém os cards dentro do turno: o modelo que responde os escreve no idioma da conversa.
- Qualquer outra escolha (idioma explícito ou modelo explícito) passa os cards para uma chamada limpa separada, com system prompt próprio. Ali o transcript é dado, não instrução, então os cards mantêm o idioma escolhido mesmo quando a conversa está em outro.
- Para chinês simplificado, japonês, coreano, russo, árabe e hindi o plugin confere o alfabeto da resposta. Uma resposta sem nenhum caractere do alfabeto alvo é descartada — você fica sem cards, nunca com cards no idioma errado.
- Se a geração falhar, nenhum card aparece e o motivo é escrito uma única vez no log do dsh. Nada é inserido no chat.
- Sem modelo selecionado, os cards usam o modelo padrão da conversa.

O turno continua terminando com a resposta depois da chamada da tool, e o plugin não adiciona to-do nudge nem limite de chamadas.

## Configurações

Abra as configurações do dsh e encontre a seção **Nextsteps**:

| Configuração | O que faz |
| --- | --- |
| Idioma | O idioma dos followups. `Automático` segue a conversa; qualquer outra escolha é garantida por uma chamada limpa separada. |
| Modelo | O modelo que gera as sugestões. `Automático` usa o modelo da conversa dentro do turno; um idioma ou modelo explícito usa uma chamada separada. |
| Followups por turno | Quantas sugestões são produzidas (1–6). |
| Estilos de sugestão | Os ângulos que as sugestões devem cobrir: *Próxima ação*, *Explorar*, *Aprofundar*. Qualquer combinação; o padrão são os três. |
| Geração | `Automático` sugere os followups quando o turno termina; `Sob demanda` espera você apertar o botão sob a resposta. |
| Orçamento de latência | Quanto tempo o gerador pode rodar antes de a requisição ser abandonada (5 000–120 000 ms). |
| Tamanho da sugestão | Quanto tempo um prompt pode ter (60–600 caracteres). |
| Mostrar cabeçalho | O pequeno rótulo acima dos cards. |

A mesma página mostra também a tabela de **desempenho** (geração, persistência e renderização, com a média, o pior tempo e a contagem de amostras), seus **favoritos** (copie ou remova) e as sugestões **descartadas** (restaure). Essas três coisas ficam só na sua máquina — nunca são enviadas ao host como configurações.

## Atualizações

A mesma página de configurações verifica novos releases no GitHub. Quando uma versão mais nova é publicada no npm, **Atualizar agora** instala pelo gerenciador de plugins do dsh e pede reinício. As atualizações instalam somente o pacote npm `dsh-nextsteps` — cópias renomeadas ou de desenvolvimento são detectadas e deixadas em paz.

## Requisitos

- DeepSeek Harness 0.2.x (desktop, perfil web).
- Node.js 20+.

## Registro de mudanças

O [CHANGELOG.md](CHANGELOG.md) lista todas as mudanças publicadas.

## Licença

[MIT](LICENSE)
