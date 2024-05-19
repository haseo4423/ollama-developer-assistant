import axios from 'axios';
import { config } from 'process';
import * as vscode from 'vscode';
import { messageHeaderSub } from '../extension';
import { Config, getConfig } from '../model/vscode-config.model';

export default class autocompleteCommandProvider {
    private config: Config = getConfig();
    constructor(private context: vscode.ExtensionContext) {
    }

    // internal function for autocomplete, not directly exposed
    public async autocompleteCommand(textEditor: vscode.TextEditor, cancellationToken?: vscode.CancellationToken) {
        const document = textEditor.document;
        const position = textEditor.selection.active;

        // Get the current prompt
        let prompt = document.getText(new vscode.Range(document.lineAt(0).range.start, position));
        prompt = prompt.substring(Math.max(0, prompt.length - this.config.promptWindowSize), prompt.length);

        // Show a progress message
        vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Ollama Autocoder",
                cancellable: true,
            },
            async (progress, progressCancellationToken) => {
                try {
                    progress.report({ message: "Starting model..." });

                    let axiosCancelPost: () => void;
                    const axiosCancelToken = new axios.CancelToken((c) => {
                        const cancelPost = function () {
                            c("Autocompletion request terminated by user cancel");
                        };
                        axiosCancelPost = cancelPost;
                        if (cancellationToken) { cancellationToken.onCancellationRequested(cancelPost); }
                        progressCancellationToken.onCancellationRequested(cancelPost);
                        vscode.workspace.onDidCloseTextDocument(cancelPost);
                    });

                    // Make a request to the ollama.ai REST API
                    console.log(messageHeaderSub(textEditor.document) + prompt)
                    const response = await axios.post(this.config.apiEndpoint, {
                        model: this.config.apiModel, // Change this to the model you want to use
                        prompt: messageHeaderSub(textEditor.document) + prompt,
                        stream: true,
                        raw: true,
                        options: {
                            num_predict: this.config.numPredict,
                            temperature: this.config.apiTemperature,
                            stop: ["```"]
                        }
                    }, {
                        cancelToken: axiosCancelToken,
                        responseType: 'stream'
                    }
                    );

                    //tracker
                    let currentPosition = position;

                    response.data.on('data', async (d: Uint8Array) => {
                        progress.report({ message: "Generating..." });

                        // Check for user input (cancel)
                        if (currentPosition.line != textEditor.selection.end.line || currentPosition.character != textEditor.selection.end.character) {
                            axiosCancelPost(); // cancel axios => cancel finished promise => close notification
                            return;
                        }

                        // Get a completion from the response
                        const completion: string = JSON.parse(d.toString()).response;
                        // lastToken = completion;

                        if (completion === "") {
                            return;
                        }

                        //complete edit for token
                        const edit = new vscode.WorkspaceEdit();
                        edit.insert(document.uri, currentPosition, completion);
                        await vscode.workspace.applyEdit(edit);

                        // Move the cursor to the end of the completion
                        const completionLines = completion.split("\n");
                        const newPosition = new vscode.Position(
                            currentPosition.line + completionLines.length - 1,
                            (completionLines.length > 1 ? 0 : currentPosition.character) + completionLines[completionLines.length - 1].length
                        );
                        const newSelection = new vscode.Selection(
                            position,
                            newPosition
                        );
                        currentPosition = newPosition;

                        // completion bar
                        progress.report({ message: "Generating...", increment: 1 / (this.config.numPredict / 100) });

                        // move cursor
                        textEditor.selection = newSelection;
                    });

                    // Keep cancel window available
                    const finished = new Promise((resolve) => {
                        response.data.on('end', () => {
                            progress.report({ message: "Ollama completion finished." });
                            resolve(true);
                        });
                        axiosCancelToken.promise.finally(() => { // prevent notification from freezing on user input cancel
                            resolve(false);
                        });
                    });

                    await finished;

                } catch (err: any) {
                    // Show an error message
                    vscode.window.showErrorMessage(
                        "Ollama encountered an error: " + err.message
                    );
                    console.log(err);
                }
            }
        );
    }
}

