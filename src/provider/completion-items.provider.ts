import * as vscode from 'vscode';
import { Config, getConfig } from '../model/vscode-config.model';
import axios from 'axios';
import { messageHeaderSub } from '../extension';

export default class CompletionItemsProvider implements vscode.CompletionItemProvider {
    private config: Config = getConfig();
    constructor(private context: vscode.ExtensionContext) {
    }

    public async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, cancellationToken: vscode.CancellationToken) {

        // Create a completion item
        const item = new vscode.CompletionItem("Autocomplete with Ollama");

        // Set the insert text to a placeholder
        item.insertText = new vscode.SnippetString('${1:}');

        // Wait before initializing Ollama to reduce compute usage
        if (this.config.responsePreview) { await new Promise(resolve => setTimeout(resolve, this.config.responsePreviewDelay * 1000)); }
        if (cancellationToken.isCancellationRequested) {
            return [item];
        }

        // Set the label & inset text to a shortened, non-stream response
        if (this.config.responsePreview) {
            let prompt = document.getText(new vscode.Range(document.lineAt(0).range.start, position));
            prompt = prompt.substring(Math.max(0, prompt.length - this.config.promptWindowSize), prompt.length);

            const response_preview = await axios.post(this.config.apiEndpoint, {
                model: this.config.apiModel, // Change this to the model you want to use
                prompt: messageHeaderSub(document) + prompt,
                stream: false,
                raw: true,
                options: {
                    num_predict: this.config.responsePreviewMaxTokens, // reduced compute max
                    temperature: this.config.apiTemperature,
                    stop: ['\n', '```']
                }
            }, {
                cancelToken: new axios.CancelToken((c) => {
                    const cancelPost = function () {
                        c("Autocompletion request terminated by completion cancel");
                    };
                    cancellationToken.onCancellationRequested(cancelPost);
                })
            });

            if (response_preview.data.response.trim() != "") { // default if empty
                item.label = response_preview.data.response.trimStart(); // tended to add whitespace at the beginning
                item.insertText = response_preview.data.response.trimStart();
            }
        }

        // Set the documentation to a message
        item.documentation = new vscode.MarkdownString('Press `Enter` to get an autocompletion from Ollama');
        // Set the command to trigger the completion
        if (this.config.continueInline || !this.config.responsePreview) {
            item.command = {
                command: 'ollama-developer-assistant.autocomplete',
                title: 'Autocomplete with Ollama',
                arguments: [cancellationToken]
            };
        }
        // Return the completion item
        return [item];
    }
}