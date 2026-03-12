import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { implementVariantInTempProject } from "../electron/services/variantImplementation.mjs";

test("recovers temp-copy edits when the implementer throws after writing files", async () => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mutatr-fixture-"));
  try {
    await fs.mkdir(path.join(fixtureRoot, "app"), { recursive: true });
    await fs.mkdir(path.join(fixtureRoot, "components"), { recursive: true });
    await fs.mkdir(path.join(fixtureRoot, "node_modules"), { recursive: true });
    await fs.writeFile(
      path.join(fixtureRoot, "app/page.tsx"),
      [
        "import { Hero } from \"../components/Hero\";",
        "",
        "export default function Page() {",
        "  return <Hero />;",
        "}",
        "",
      ].join("\n"),
      "utf8"
    );
    await fs.writeFile(
      path.join(fixtureRoot, "components/Hero.tsx"),
      [
        "export function Hero() {",
        "  return <div>hello</div>;",
        "}",
        "",
      ].join("\n"),
      "utf8"
    );

    const result = await implementVariantInTempProject({
      projectRoot: fixtureRoot,
      page: { route: "/", filePath: path.join(fixtureRoot, "app/page.tsx") },
      test: {
        title: "Surface social proof earlier",
        implementationPrompt: "Add lightweight social proof above the fold.",
      },
      implementer: async ({ projectRoot }) => {
        await fs.writeFile(
          path.join(projectRoot, "components/Hero.tsx"),
          [
            "export function Hero() {",
            "  return <div>social proof</div>;",
            "}",
            "",
          ].join("\n"),
          "utf8"
        );
        throw new Error("Claude query failed (error_max_turns).");
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.recoveredFromError, true);
    assert.deepEqual(result.impl.changedFiles, ["components/Hero.tsx"]);
    assert.match(result.impl.summary, /Recovered applied edits/);

    const recovered = await fs.readFile(path.join(result.tempRoot, "components/Hero.tsx"), "utf8");
    assert.match(recovered, /social proof/);

    await fs.rm(result.tempRoot, { recursive: true, force: true });
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("fails if the implementer throws before producing any edits", async () => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mutatr-fixture-"));
  try {
    await fs.mkdir(path.join(fixtureRoot, "app"), { recursive: true });
    await fs.mkdir(path.join(fixtureRoot, "node_modules"), { recursive: true });
    await fs.writeFile(
      path.join(fixtureRoot, "app/page.tsx"),
      "export default function Page() { return null; }\n",
      "utf8"
    );

    await assert.rejects(
      () =>
        implementVariantInTempProject({
          projectRoot: fixtureRoot,
          page: { route: "/", filePath: path.join(fixtureRoot, "app/page.tsx") },
          test: {
            title: "Surface social proof earlier",
            implementationPrompt: "Add lightweight social proof above the fold.",
          },
          implementer: async () => {
            throw new Error("Claude query failed (error_max_turns).");
          },
        }),
      /error_max_turns/
    );
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});
