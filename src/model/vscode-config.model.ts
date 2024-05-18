import * as vscode from 'vscode';

export interface Config {
    apiEndpoint: string,
    apiModel: string,
    apiMessageHeader: string,
    apiTemperature: number,
    numPredict: number,
    promptWindowSize: number,
    completionKeys: string,
    responsePreview: boolean | undefined,
    responsePreviewMaxTokens: number,
    responsePreviewDelay: number,
    continueInline: boolean | undefined
}

export function getConfig(): Config {
    const VSConfig = vscode.workspace.getConfiguration("ollama-developer-assistant");
    return {
        apiEndpoint: VSConfig.get("endpoint") || "http://localhost:11434/api/generate",
        apiModel: VSConfig.get("model") || "openhermes2.5-mistral:7b-q4_K_M", // The model I tested with
        apiMessageHeader: VSConfig.get("message header") || "",
        numPredict: VSConfig.get("max tokens predicted") || 1000,
        promptWindowSize: VSConfig.get("prompt window size") || 2000,
        completionKeys: VSConfig.get("completion keys") || " ",
        responsePreview: VSConfig.get("response preview"),
        responsePreviewMaxTokens: VSConfig.get("preview max tokens") || 50,
        responsePreviewDelay: VSConfig.get("preview delay") || 0, // Must be || 0 instead of || [default] because of truthy
        continueInline: VSConfig.get("continue inline"),
        apiTemperature: VSConfig.get("temperature") || 0.5,
    }
}