interface Message {
    m: string;
}

interface ChatMessage extends Message {
    m: 'a';
}

interface MessageWithTimestamp extends Message {
    m: string;
    t: number;
}

interface ServerChatMessage extends ChatMessage, MessageWithTimestamp {
    m: 'a';
    a: string;
}

interface ClientChatMessage extends ChatMessage, MessageWithTimestamp {
    m: 'a';
    message: string;
}

export {
    Message,
    ChatMessage,
    MessageWithTimestamp,
    ServerChatMessage,
    ClientChatMessage
};
