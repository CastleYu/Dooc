import { spawnSync } from "node:child_process";

export function plantuml(source: string): { ok: boolean; svg?: string; error?: string } {
  if (!source.trim()) return { ok: false, error: "PlantUML 源码为空" };
  const jar = process.env.PLANTUML_JAR;
  const attempts: { cmd: string; args: string[] }[] = [];
  if (jar) attempts.push({ cmd: "java", args: ["-jar", jar, "-tsvg", "-pipe", "-failfast2", "-charset", "UTF-8"] });
  attempts.push({ cmd: "plantuml", args: ["-tsvg", "-pipe", "-failfast2", "-charset", "UTF-8"] });
  let last = "未找到 PlantUML 编译器。安装 plantuml 命令，或设置 PLANTUML_JAR 指向 jar 文件。";
  for (const attempt of attempts) {
    const res = spawnSync(attempt.cmd, attempt.args, { input: source, encoding: "utf8", timeout: 20000 });
    if (res.error && (res.error as NodeJS.ErrnoException).code === "ENOENT") continue;
    const stdout = res.stdout ?? "";
    const stderr = (res.stderr ?? "").trim();
    if (res.status === 0 && stdout.includes("<svg")) return { ok: true, svg: stdout };
    last = stderr || stdout.trim() || `PlantUML 退出码 ${res.status}`;
  }
  return { ok: false, error: last };
}
