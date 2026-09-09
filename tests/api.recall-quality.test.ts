import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { makeTempHome } from "./helpers.js";

it("retrieves Portuguese sources, disambiguates domains and returns no invented source", async () => {
  const temp = makeTempHome();
  const files: Record<string, string> = {
    "banco-dados.md":
      "# Banco de dados\n\n## Recuperação\nO backup SQLite do projeto Atlas fica na pasta cofres. A restauração exige validar integridade.",
    "banco-financeiro.md":
      "# Banco financeiro\n\n## Pagamento\nA transferência do projeto Atlas foi aprovada por Marina no valor de 3200 reais.",
    "mobile.md":
      "# Aplicativo mobile\n\n## Desempenho\nO Metro do aplicativo Aurora usa porta 8081. O simulador iOS consome memória durante a compilação.",
    "agenda.md":
      "# Agenda\n\n## Revisão\nA revisão do projeto Aurora será terça-feira às 14 horas com Renata.",
  };
  const ctx = new AppContext(temp.paths.home);
  const app = await buildServer(ctx);
  const headers = { "x-mordomo-token": ctx.token() };
  const cases = [
    { q: "Onde fica o backup SQLite do banco de dados Atlas?", file: "banco-dados.md", text: "cofres" },
    {
      q: "Quem aprovou a transferência do banco financeiro Atlas?",
      file: "banco-financeiro.md",
      text: "Marina",
    },
    { q: "Qual porta usa o Metro Aurora?", file: "mobile.md", text: "8081" },
    { q: "Quando será a revisão Aurora com Renata?", file: "agenda.md", text: "14 horas" },
  ];
  try {
    for (const [name, content] of Object.entries(files))
      fs.writeFileSync(path.join(ctx.paths.memory, name), content);
    expect((await app.inject({ method: "POST", url: "/api/memory/index", headers })).statusCode).toBe(200);
    for (const row of cases) {
      const response = await app.inject({
        method: "GET",
        url: `/api/memory/recall?k=2&q=${encodeURIComponent(row.q)}`,
        headers,
      });
      expect(response.statusCode).toBe(200);
      const contexts = response.json().answerContext as Array<{ path: string; excerpt: string }>;
      expect(contexts[0]?.path, row.q).toBe(path.join(ctx.paths.memory, row.file));
      expect(contexts[0]?.excerpt).toContain(row.text);
      for (const context of contexts)
        expect(fs.readFileSync(context.path, "utf8")).toContain(context.excerpt);
    }
    const absent = await app.inject({
      method: "GET",
      url: "/api/memory/recall?q=xenobiologiaquantica",
      headers,
    });
    expect(absent.json().answerContext).toEqual([]);
  } finally {
    await app.close();
    ctx.close();
    temp.cleanup();
  }
});
