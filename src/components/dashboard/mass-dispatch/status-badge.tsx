"use client";

const STATUS_STYLE: Record<string, string> = {
    draft: "bg-slate-100 text-slate-600",
    scheduled: "bg-blue-50 text-blue-700 ring-1 ring-blue-100",
    preparing: "bg-orange-50 text-orange-700 ring-1 ring-orange-100",
    running: "bg-orange-50 text-orange-700 ring-1 ring-orange-100",
    paused: "bg-amber-50 text-amber-800 ring-1 ring-amber-100",
    completed: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100",
    completed_with_errors: "bg-red-50 text-red-700 ring-1 ring-red-100",
    cancelled: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
    failed: "bg-red-50 text-red-700 ring-1 ring-red-100",
};

export function CampaignStatusBadge({
    status,
    label,
}: {
    status: string;
    label: string;
}) {
    const cls =
        STATUS_STYLE[status] || "bg-slate-100 text-slate-600 ring-1 ring-slate-200";
    return (
        <span
            className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap ${cls}`}
        >
            {label}
        </span>
    );
}
