export const QUICK_REVIEW_MODES = [
  {
    id: "punctuation",
    instruction:
      "请纠正文章中的错别字、病句和标点错误，只提出必要的最小修改，并保持原意和 Markdown 结构。",
    label: "纠正标点语法",
  },
  {
    id: "bold",
    instruction:
      "请识别对公众阅读最重要的短语或句子，并用 Markdown **粗体**突出，避免过度加粗或改变原意。",
    label: "重点加粗",
  },
  {
    id: "readability",
    instruction:
      "请对文章进行通俗化润色：把过长、结构复杂或信息过密的句子拆成自然、易读的短句；把专业术语、抽象表达和行业黑话改用公众容易理解的简单概念表达。保持原意、事实、语气和 Markdown 结构，不扩写，也不改写无关内容。",
    label: "通俗化润色",
  },
] as const;

export type QuickReviewModeId = (typeof QUICK_REVIEW_MODES)[number]["id"];

export function buildAiReviewInstruction(
  selectedModeIds: ReadonlySet<QuickReviewModeId>,
  customInstruction: string,
): string {
  const selectedInstructions = QUICK_REVIEW_MODES.filter((mode) =>
    selectedModeIds.has(mode.id),
  ).map((mode) => mode.instruction);
  const normalizedCustomInstruction = customInstruction.trim();

  const sections: string[] = [];

  if (selectedInstructions.length > 0) {
    sections.push(
      [
        "请在同一轮审阅中同时完成以下要求：",
        ...selectedInstructions.map(
          (instruction, index) => `${index + 1}. ${instruction}`,
        ),
      ].join("\n"),
    );
  }

  if (normalizedCustomInstruction) {
    sections.push(`补充要求：${normalizedCustomInstruction}`);
  }

  return sections.join("\n\n");
}
