# Adaptadores tipados — design do aviso de versão (binding)

Uma tela muda: **Configurações › Provedores**. O aviso só informa; não bloqueia nem muda uma execução (door 3).

## Tela - Configurações › Provedores, aviso de versão

Cada provedor já tem um cartão (`.provider-row`) com, de cima para baixo: o cabeçalho (`.provider-head`: nome, id, status,
selos, ações), o bloco de recuperação de login quando o login não está verificado (`.auth-recovery`) e a grade de campos
(`.grid`). O aviso é **um parágrafo a mais dentro do cartão, entre o cabeçalho e o resto**:

```
┌ cartão do provedor ─────────────────────────────────────────┐
│ cabeçalho (nome, status, ativo, teste)                      │
│ aviso de versão          ← só quando older ou newer         │
│ recuperação de login     ← só quando o login não é verificado│
│ grade (modelo, esforço, caminho)                            │
└─────────────────────────────────────────────────────────────┘
```

### Quando aparece

| `versionStatus`                                                                 | Aviso |
| ------------------------------------------------------------------------------- | ----- |
| `older`                                                                         | sim   |
| `newer`                                                                         | sim   |
| `tested`                                                                        | nunca |
| `unknown`                                                                       | nunca |
| campo ausente (servidor antigo), sem `installedVersion` ou sem `testedVersions` | nunca |

### Forma

- Um `<p class="meta" role="note">` por cartão, **filho direto do cartão**; nunca um aviso compartilhado no topo da aba, nunca um selo
  nem um diálogo.
- Uma frase de texto simples, sem marcação dentro: a versão lida, a faixa e o que fazer. O tom é de informação (`meta`), não de alerta.
- A versão mostrada é o semver lido (`installedVersion`), nunca o texto cru de `--version`.

### Texto (chaves `settings.versionOlder` e `settings.versionNewer`; `{version}`, `{min}`, `{max}`)

| Estado  | English                                                                                                                                                                                                 | Português                                                                                                                                                                                                                                         |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `older` | Installed version {version} is older than the range this MordomoOS release was developed against ({min}–{max}). Runs still go ahead; update the CLI if something looks wrong.                           | A versão instalada {version} é mais antiga que a faixa com que esta versão do MordomoOS foi desenvolvida ({min}–{max}). As execuções seguem normalmente; atualize a CLI se algo parecer errado.                                                   |
| `newer` | Installed version {version} is newer than the range this MordomoOS release was developed against ({min}–{max}). Runs still go ahead; if usage, cost or changed files look incomplete, update MordomoOS. | A versão instalada {version} é mais recente que a faixa com que esta versão do MordomoOS foi desenvolvida ({min}–{max}). As execuções seguem normalmente; se o uso, o custo ou os arquivos alterados parecerem incompletos, atualize o MordomoOS. |

### Fora deste design

Espaçamento, cor e peso do tipo do parágrafo vêm dos tokens da classe `meta` do sistema de design; nenhum check os mede.
