"use client";

import { useEffect, useState } from "react";
import moment from "moment-timezone";
import { Clock } from "lucide-react";

export function RealtimeClock() {
    const [time, setTime] = useState("");
    const [timezone, setTimezone] = useState("Asia/Jakarta");
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
        // Fetch global timezone
        fetch('/api/settings/system')
            .then(r => r.json())
            .then(data => {
                if (data && data.data && data.data.timezone) {
                    setTimezone(data.data.timezone);
                }
            })
            .catch(() => { });
    }, []);

    useEffect(() => {
        if (!mounted) return;

        const updateTime = () => {
            setTime(moment().tz(timezone).format("HH:mm:ss"));
        };

        updateTime();
        const interval = setInterval(updateTime, 1000);
        return () => clearInterval(interval);
    }, [timezone, mounted]);

    if (!mounted) return null;

    return (
        <div className="flex items-center gap-2 px-2.5 py-1.5 bg-slate-50 rounded-xl border border-slate-200/80 text-sm font-medium text-slate-700 shrink-0 whitespace-nowrap">
            <Clock className="h-4 w-4 text-slate-500 shrink-0" />
            <span className="tabular-nums">{time}</span>
            <span className="text-[10px] text-slate-400 border-l border-slate-200 pl-2 ml-0.5 hidden lg:inline">
                {timezone}
            </span>
        </div>
    );
}
