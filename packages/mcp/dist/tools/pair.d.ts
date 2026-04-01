export declare function handlePair(params: {
    forceNew?: boolean;
}, endpoint?: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
