"use client";

import { ProviderUnavailablePanel } from "./provider-unavailable";

export function DatafyChatPlaceholder({
    channelName,
    displayPhoneNumber,
}: {
    channelName?: string | null;
    displayPhoneNumber?: string | null;
    status?: string | null;
}) {
    return (
        <ProviderUnavailablePanel
            feature="chat"
            channelName={channelName}
            displayPhoneNumber={displayPhoneNumber}
        />
    );
}
