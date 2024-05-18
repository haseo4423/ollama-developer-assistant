import { Ollama } from '@langchain/community/llms/ollama';
import axios from 'axios';
import * as vscode from 'vscode';
import { CheerioWebBaseLoader } from "langchain/document_loaders/web/cheerio";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter"
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { RetrievalQAChain } from "langchain/chains";
import { OllamaEmbeddings } from '@langchain/community/embeddings/ollama';
import ChatViewProvider from './chat-view-provider';
import CompletionItemsProvider from './provider/completion-items.provider';
import { Config, getConfig } from './model/vscode-config.model';

let config: Config = getConfig();

// No need for restart for any of these settings
vscode.workspace.onDidChangeConfiguration(() => { config = getConfig() });

// Give model additional information
export function messageHeaderSub(document: vscode.TextDocument) {
	const sub = config.apiMessageHeader
		.replace("{LANG}", document.languageId)
		.replace("{FILE_NAME}", document.fileName)
		.replace("{PROJECT_NAME}", vscode.workspace.name || "Untitled");
	return sub;
}

// internal function for autocomplete, not directly exposed
async function autocompleteCommand(textEditor: vscode.TextEditor, cancellationToken?: vscode.CancellationToken) {
	const document = textEditor.document;
	const position = textEditor.selection.active;

	// Get the current prompt
	let prompt = document.getText(new vscode.Range(document.lineAt(0).range.start, position));
	prompt = prompt.substring(Math.max(0, prompt.length - config.promptWindowSize), prompt.length);

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
				const response = await axios.post(config.apiEndpoint, {
					model: config.apiModel, // Change this to the model you want to use
					prompt: messageHeaderSub(textEditor.document) + prompt,
					stream: true,
					raw: true,
					options: {
						num_predict: config.numPredict,
						temperature: config.apiTemperature,
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
					progress.report({ message: "Generating...", increment: 1 / (config.numPredict / 100) });

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

export function activate(context: vscode.ExtensionContext) {

	console.log('Congratulations, your extension "ollama-developer-assistant" is now active!');

	const provider = new ChatViewProvider(context);
	const provideCompletionItems = new CompletionItemsProvider(context);

	const view = vscode.window.registerWebviewViewProvider(
		"chat.view",
		provider,
		{
			webviewOptions: {
				retainContextWhenHidden: true,
			},
		}
	);

	const completionProvider = vscode.languages.registerCompletionItemProvider("*", provideCompletionItems, ...config.completionKeys.split(""));

	let disposable = vscode.commands.registerCommand('ollama-developer-assistant.helloWorld', async () => {

		const ollama = new Ollama({ baseUrl: "http://localhost:11434", model: "llama3" })
		// const answer = await ollama.invoke(`why is the sky blue?`)

		const loader = new CheerioWebBaseLoader("https://en.wikipedia.org/wiki/2023_Hawaii_wildfires");
		const data = await loader.load();
		console.log('1')

		// Split the text into 500 character chunks. And overlap each chunk by 20 characters
		const textSplitter = new RecursiveCharacterTextSplitter({
			chunkSize: 500,
			chunkOverlap: 20
		});
		const splitDocs = await textSplitter.splitDocuments(data);
		console.log('2')

		// Then use the TensorFlow Embedding to store these chunks in the datastore
		const vectorStore = await MemoryVectorStore.fromDocuments(splitDocs, new OllamaEmbeddings({ baseUrl: "http://localhost:11434", model: 'mxbai-embed-large' }));
		console.log('3', vectorStore)

		const retriever = vectorStore.asRetriever();
		const chain = RetrievalQAChain.fromLLM(ollama, retriever);
		const result = await chain.call({ query: "When was Hawaii's request for a major disaster declaration approved?" });

		vscode.window.showInformationMessage(result.text);
	});

	// Register a command for getting a completion from Ollama through command/keybind
	const externalAutocompleteCommand = vscode.commands.registerTextEditorCommand(
		"ollama-developer-assistant.autocomplete",
		(textEditor, _, cancellationToken?) => {
			// no cancellation token from here, but there is one from completionProvider
			autocompleteCommand(textEditor, cancellationToken);
		}
	);

	// Add the commands & completion provider to the context
	context.subscriptions.push(view, disposable, completionProvider, externalAutocompleteCommand);
}

// This method is called when your extension is deactivated
export function deactivate() { }

module.exports = {
	activate,
	deactivate,
};