import { Ollama } from '@langchain/community/llms/ollama';
import * as vscode from 'vscode';
import { CheerioWebBaseLoader } from "langchain/document_loaders/web/cheerio";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter"
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { RetrievalQAChain } from "langchain/chains";
import { OllamaEmbeddings } from '@langchain/community/embeddings/ollama';
import ChatViewProvider from './provider/chat-view.provider';
import CompletionItemsProvider from './provider/completion-items.provider';
import { Config, getConfig } from './model/vscode-config.model';
import autocompleteCommandProvider from './provider/autocomplete-command.provider';

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

export function activate(context: vscode.ExtensionContext) {

	console.log('Congratulations, your extension "ollama-developer-assistant" is now active!');

	const provideChatView = new ChatViewProvider(context);
	const provideCompletionItems = new CompletionItemsProvider(context);
	const provideAutocompleteCommand = new autocompleteCommandProvider(context);

	const view = vscode.window.registerWebviewViewProvider(
		"chat.view",
		provideChatView,
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
			provideAutocompleteCommand.autocompleteCommand(textEditor, cancellationToken);
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