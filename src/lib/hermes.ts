const HERMES_SKILL_DIRECTORY = "~/.hermes/skills/";
const HERMES_SKILL_FOLDER = "notes-workspace-api";

function buildHermesSkillInstruction(installUrl: string): string {
  return `请帮我安装这个 Skill：${installUrl}。请下载并解压 ZIP 包，把其中的 ${HERMES_SKILL_FOLDER} 文件夹放到 ${HERMES_SKILL_DIRECTORY}，然后读取 SKILL.md 并完成安装；安装完成后请告诉我结果，不要在回复中展示安装链接或 .env 里的凭据。`;
}

export const HERMES_SKILL_INSTALL_INSTRUCTION_PREVIEW =
  buildHermesSkillInstruction("[专属 ZIP 链接]");

export function buildHermesSkillInstallInstruction(
  installUrl: string,
): string {
  return buildHermesSkillInstruction(installUrl.trim());
}
