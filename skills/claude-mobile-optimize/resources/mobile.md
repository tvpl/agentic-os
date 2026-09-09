# Diagnóstico por stack

Leia package.json/pubspec.yaml e scripts existentes; não deduza a stack apenas pelo nome da pasta.

- **React Native / Expo:** confira se há mais de um Metro para o mesmo projeto e se raízes/watchFolders abrangem diretórios desnecessários. Examine a configuração Metro da versão instalada antes de mudar exclusões: monorepos dependem de pacotes irmãos e symlinks. Não exclua código necessário ao resolver imports. Use o bundler existente; não inicie outro para cada teste.
- **Android:** atribua RSS aos daemons Gradle/Kotlin, emulator e ferramentas Node separadamente. Inspecione gradle.properties e trabalhadores concorrentes. Ajuste workers/heap apenas com evidência de pressão e verifique compilação incremental e duração. `./gradlew --stop` pode afetar outros builds da mesma versão; confirme o escopo antes de usar.
- **iOS:** diferencie Xcode, SourceKit e Simulator. Use um dispositivo de teste já disponível e somente um build por vez. Não apague DerivedData global nem desligue simuladores alheios. Compare uma compilação incremental equivalente, sem comparar cache frio com quente.
- **Flutter:** separe analysis server, Dart VM, build e emulador. Verifique duplicação de IDE/analisador. Ajuste analysis_options apenas para artefatos gerados comprovados, preservando lint e análise do código-fonte.

Sequência econômica: typecheck/lint do módulo afetado → teste direcionado → um build relevante. Ampliar somente para contratos afetados ou gates exigidos pelo repositório. Execute um job pesado por vez quando houver pressão de memória; aumentar concorrência não é otimização automática.

Referências oficiais: [contexto](https://code.claude.com/docs/en/how-claude-code-works), [memória](https://code.claude.com/docs/en/memory), [skills](https://code.claude.com/docs/en/skills). Confira documentação da stack instalada antes de recomendar parâmetros específicos.
