/**
 * Pure helpers for the Novo/Editar template modal (UI only).
 * Does not change Meta submit rules or persistence.
 */

export type TemplateEditorButtonsDraft = {
    enabled: boolean;
    grantText: string;
    denyText: string;
};

export type TemplateEditorDraft = {
    technicalName: string;
    displayName: string;
    category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
    headerText: string;
    bodyText: string;
    footerText: string;
    buttons: TemplateEditorButtonsDraft;
    fieldMappings: string[];
    exampleRow: string[];
    loadsPerMessage: 1 | 2 | 3;
    description: string;
};

export function isDraftDirty(
    current: TemplateEditorDraft,
    baseline: TemplateEditorDraft | null
): boolean {
    if (!baseline) return false;
    return JSON.stringify(current) !== JSON.stringify(baseline);
}

/** Fill {{n}} with example values for the WhatsApp preview only. */
export function fillPreviewFromExamples(
    body: string,
    exampleRow: string[]
): string {
    return body.replace(/\{\{(\d+)\}\}/g, (_m, n) => {
        const idx = Number(n) - 1;
        const ex = exampleRow[idx];
        if (ex != null && String(ex).trim()) return String(ex);
        return `{{${n}}}`;
    });
}

export type EditorStepId = "info" | "content" | "vars" | "review";

export const EDITOR_STEPS: Array<{
    id: EditorStepId;
    label: string;
    short: string;
}> = [
    { id: "info", label: "Informações", short: "1" },
    { id: "content", label: "Conteúdo", short: "2" },
    { id: "vars", label: "Variáveis e botões", short: "3" },
    { id: "review", label: "Revisão", short: "4" },
];

export function nextEditorStep(step: EditorStepId): EditorStepId {
    const i = EDITOR_STEPS.findIndex((s) => s.id === step);
    return EDITOR_STEPS[Math.min(EDITOR_STEPS.length - 1, i + 1)]?.id || step;
}

export function prevEditorStep(step: EditorStepId): EditorStepId {
    const i = EDITOR_STEPS.findIndex((s) => s.id === step);
    return EDITOR_STEPS[Math.max(0, i - 1)]?.id || step;
}
