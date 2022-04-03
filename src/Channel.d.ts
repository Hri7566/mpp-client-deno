interface Crown {
    [key: string]: unknown;
}

interface Channel {
    _id: string;
    settings: Record<string, string | boolean>;
    crown: Crown;
}

export {
    Channel
}
