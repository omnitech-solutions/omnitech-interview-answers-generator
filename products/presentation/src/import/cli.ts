import { createPlatformDatabase } from "@omnitech/platform-storage";
import { writeFile } from "node:fs/promises";
import { importPresentationStudio } from "./index.js";

function value(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);
}

const sourceSecret = value("source-database-url-secret");
const targetTenantId = value("target-tenant");
const reportPath = value("report");
if (!sourceSecret || !targetTenantId || !reportPath) {
  throw new Error(
    "--source-database-url-secret, --target-tenant, and --report are required.",
  );
}
const sourceUrl = process.env[sourceSecret];
if (!sourceUrl) {
  throw new Error(`The source secret "${sourceSecret}" is not configured.`);
}

const source = createPlatformDatabase(sourceUrl);
const target = createPlatformDatabase();
try {
  const report = await importPresentationStudio(source, target, {
    targetTenantId,
    dryRun: process.argv.includes("--dry-run"),
    batchSize: Number(value("batch-size") ?? "100"),
    conflictPolicy: "report",
    verifyOnly: process.argv.includes("--verify-only"),
    ...(value("resume-from") === undefined
      ? {}
      : { resumeFrom: value("resume-from") as string }),
  });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
  });
} finally {
  await source.close();
  await target.close();
}
